import { NextResponse } from "next/server";
import { AuthError, currentSession, type SessionClaims } from "@/lib/auth";
import { logger, reportError } from "@/lib/observability/logger";
import {
  consumeRateLimit,
  rateLimitHeaders,
  rateLimitTiers,
  requestSubject,
  type RateLimitTier
} from "@/lib/rate-limit";

/**
 * The single entry point for authenticating an API route.
 *
 * The problem this solves: `middleware.ts` runs in the Edge runtime, which has
 * no TCP sockets and therefore cannot reach Postgres. It can verify a session
 * cookie's signature and expiry, and nothing else. Logout, admin-initiated
 * revocation, and the revocation that follows a password change all work by
 * writing `revoked_at` on `user_sessions` - a column Edge middleware cannot
 * read. So a cookie kept working for up to its twelve-hour idle window on every
 * route that did not independently call `currentSession()`, which was six of a
 * hundred and six.
 *
 * Switching middleware to the Node runtime is not the fix on this Next.js
 * version. Its exported `config` is validated by a `.strict()` schema that
 * accepts only `matcher`, `regions`, and `unstable_allowDynamic`; adding
 * `runtime: "nodejs"` fails that validation and Next silently drops the
 * middleware entirely, with a clean build and an empty
 * `.next/server/middleware-manifest.json`. Verify that manifest is non-empty
 * before believing any future change to middleware took effect.
 *
 * So enforcement lives here, in route handlers, which do run in Node. Wrapping
 * rather than open-coding `currentSession()` matters for auditability: whether a
 * route is protected becomes a question of whether it imports `guard`, which is
 * a grep, instead of a question of what its body does, which is a code review.
 */

export type GuardOptions = {
  /** Require an admin role. Rejects a valid member session with 403. */
  admin?: boolean;
  /**
   * Which allowance this route draws on. Defaults to `standard`, which is a
   * backstop rather than a real constraint; routes that dispatch model or
   * provider spend should declare `expensive`.
   */
  rateLimit?: RateLimitTier;
};

export type GuardedContext<Params> = {
  session: SessionClaims;
  params: Params;
};

type RouteHandler<Params> = (
  request: Request,
  context: GuardedContext<Params>
) => Promise<Response> | Response;

/**
 * Next passes route params as `{ params: Promise<...> }`. Accepting that shape
 * and awaiting it here means handlers receive resolved params and no route needs
 * to remember to await them.
 *
 * Not optional, even though a non-dynamic route has no params to speak of. Next
 * generates a type check per route under `.next/types` that requires the second
 * argument to be assignable to its own `RouteContext`, and a union with
 * `undefined` fails that check for every route at once. The runtime access below
 * stays defensive regardless, since what Next actually passes for a static route
 * is not worth depending on.
 */
type NextRouteArgs<Params> = { params: Promise<Params> };

export function guard<Params = Record<string, never>>(
  handler: RouteHandler<Params>,
  options: GuardOptions = {}
) {
  return async function guarded(request: Request, args: NextRouteArgs<Params>) {
    const tier = options.rateLimit ?? "standard";

    // Rate limiting comes first, keyed by origin rather than by session. An
    // unauthenticated flood must be cheap to reject, and doing session lookup
    // first would make every rejected request cost a database round trip -
    // turning the limiter into an amplifier.
    const limit = await consumeRateLimit(requestSubject(request), tier);
    if (!limit.allowed) {
      logger.warn("ratelimit.rejected", {
        tier,
        path: new URL(request.url).pathname,
        method: request.method
      });
      return NextResponse.json(
        { error: "rate_limited", detail: rateLimitTiers[tier].reason },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }

    let session: SessionClaims;
    try {
      // The database-backed check. This is the line the whole module exists for.
      session = await currentSession({ admin: options.admin });
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status, headers: rateLimitHeaders(limit) }
        );
      }
      // An unexpected failure here must not read as "authorized". Fail closed.
      reportError("guard.session_check_failed", error, {
        path: new URL(request.url).pathname
      });
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
      const params = (args?.params ? await args.params : {}) as Params;
      const response = await handler(request, { session, params });
      for (const [key, value] of Object.entries(rateLimitHeaders(limit))) {
        response.headers.set(key, value);
      }
      return response;
    } catch (error) {
      // A route that throws an AuthError from deeper in its own logic still
      // deserves its intended status rather than a generic 500.
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      reportError("route.unhandled", error, {
        path: new URL(request.url).pathname,
        method: request.method,
        userId: session.userId
      });
      // Deliberately opaque. The detail is in the log, where it is useful, not
      // in the response, where it leaks schema and internal structure.
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}

/**
 * For the few routes that are deliberately public - login, health - so that
 * "unprotected" is something a route states rather than something it omits.
 * A grep for routes importing neither `guard` nor `publicRoute` is then a
 * complete list of what has been missed.
 */
export function publicRoute<Params = Record<string, never>>(
  handler: (request: Request, context: { params: Params }) => Promise<Response> | Response,
  options: { rateLimit?: RateLimitTier } = {}
) {
  return async function open(request: Request, args: NextRouteArgs<Params>) {
    const tier = options.rateLimit ?? "standard";
    const limit = await consumeRateLimit(requestSubject(request), tier);
    if (!limit.allowed) {
      logger.warn("ratelimit.rejected", {
        tier,
        path: new URL(request.url).pathname,
        method: request.method
      });
      return NextResponse.json(
        { error: "rate_limited", detail: rateLimitTiers[tier].reason },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }
    try {
      const params = (args?.params ? await args.params : {}) as Params;
      const response = await handler(request, { params });
      for (const [key, value] of Object.entries(rateLimitHeaders(limit))) {
        response.headers.set(key, value);
      }
      return response;
    } catch (error) {
      reportError("route.unhandled", error, {
        path: new URL(request.url).pathname,
        method: request.method
      });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}
