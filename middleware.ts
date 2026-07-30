import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "mti_session";
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/health",
  "/api/v1/auth/login"
]);
const ADMIN_API_PREFIXES = [
  "/api/v1/admin/",
  "/api/v1/settings/models",
  "/api/v1/settings/integrations"
];

type Claims = {
  role: "admin" | "member";
  expiresAt: number;
};

/**
 * Edge middleware: a fast outer filter, not the authorization boundary.
 *
 * It cannot reach Postgres (Edge runtime has no TCP sockets, and — confirmed
 * empirically, not assumed — this Next.js version's middleware `config` schema
 * is `.strict()` with no `runtime` key, so declaring `runtime: "nodejs"`
 * doesn't switch runtimes, it fails schema validation and Next drops the
 * middleware entirely with no build error. Do not reintroduce that without
 * confirming the manifest at .next/server/middleware-manifest.json is
 * non-empty after the build).
 *
 * So it can verify a cookie's signature and expiry and nothing else. In
 * particular it cannot see `revoked_at`, which is what logout, admin
 * revocation, and a post-password-change kill all write. That check now
 * happens in `lib/api/guard.ts`, which wraps every route under `app/api/v1/`
 * and runs in Node where the database is reachable. This file's job is to
 * reject obvious garbage cheaply and to redirect browsers to the login page;
 * it is deliberately not the thing standing between a revoked cookie and
 * client data.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Perimeter first, before any application logic. Everything below this point
  // assumes the request already cleared the outer gate.
  const gate = basicAuthGate(request, path);
  if (gate) return gate;

  if (PUBLIC_PATHS.has(path)) return NextResponse.next();

  if (path.startsWith("/api/internal/")) {
    const secret = process.env.WORKFLOW_CALLBACK_SECRET;
    if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessionSecret = process.env.AUTH_SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "authentication_not_configured" }, { status: 503 });
    }
    return NextResponse.next();
  }

  const claims = await verifyCookie(request.cookies.get(COOKIE_NAME)?.value, sessionSecret);
  if (!claims) return unauthenticated(request);
  if (ADMIN_API_PREFIXES.some((prefix) => path.startsWith(prefix)) && claims.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (isMutation(request.method) && !sameOrigin(request)) {
    return NextResponse.json({ error: "csrf_validation_failed" }, { status: 403 });
  }
  return NextResponse.next();
}

/**
 * An optional HTTP Basic gate in front of the whole deployment.
 *
 * `railway/README.md` has always told operators to generate a Basic Auth
 * secret, and `.env.example` has always declared the pair, but nothing read
 * them - so anyone following the deployment guide believed a perimeter existed
 * that did not. Implementing it is the right resolution rather than deleting
 * the variables: a coarse outer gate is genuinely useful on a staging or
 * preview deployment, where the value is keeping scanners and search engines
 * away from the login page entirely.
 *
 * Enabled only when both variables are set, so this is opt-in and absent
 * configuration changes nothing.
 *
 * Returns null to mean "allowed, keep going" and a response to mean "stop".
 */
function basicAuthGate(request: NextRequest, path: string) {
  const user = process.env.APP_BASIC_AUTH_USER;
  const password = process.env.APP_BASIC_AUTH_PASSWORD;
  if (!user || !password) return null;

  // Two carve-outs, both load-bearing.
  //
  // `/api/health` is what the platform polls to decide whether this instance is
  // alive. Behind Basic auth every probe would 401 and the deployment would be
  // restarted in a loop.
  //
  // `/api/internal/**` is how Trigger.dev workers call back in. When
  // BUSINESS_OS_INTERNAL_URL points at this same origin - which is the normal
  // setup - a perimeter here would reject every callback, and every campaign
  // would fail on its first step with an error that looks nothing like its
  // cause. Those paths carry their own bearer-token check immediately below,
  // so they are not left open by this exemption.
  if (path === "/api/health" || path.startsWith("/api/internal/")) return null;

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    // Split on the first colon only: a password may legitimately contain one.
    const separator = decoded.indexOf(":");
    const suppliedUser = separator === -1 ? "" : decoded.slice(0, separator);
    const suppliedPassword = separator === -1 ? "" : decoded.slice(separator + 1);
    if (constantTimeEquals(suppliedUser, user) && constantTimeEquals(suppliedPassword, password)) {
      return null;
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      // Without this a browser shows the bare 401 body instead of prompting.
      "WWW-Authenticate": 'Basic realm="MTI OS", charset="UTF-8"',
      // A 401 that a shared cache could serve to the next visitor would be a
      // small but real information leak about which paths exist.
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Compares two strings without returning early on the first difference.
 *
 * The Edge runtime has no `node:crypto`, so `timingSafeEqual` is unavailable
 * and this is written out. Lengths are folded into the accumulator rather than
 * checked up front, because an early length return is itself a timing signal.
 */
function constantTimeEquals(left: string, right: string) {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function unauthenticated(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") {
    login.searchParams.set("next", request.nextUrl.pathname);
  }
  return NextResponse.redirect(login);
}

function isMutation(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return origin === `${forwardedProto}://${forwardedHost}`;
}

async function verifyCookie(value: string | undefined, secret: string): Promise<Claims | null> {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(payload)
  );
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as Claims;
    return claims.expiresAt > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
