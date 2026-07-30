import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticate,
  AuthError,
  requestMetadata,
  SESSION_COOKIE,
  SESSION_IDLE_MS
} from "@/lib/auth";
import { publicRoute } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { logger } from "@/lib/observability/logger";

const schema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128)
});

/**
 * Public by necessity, and rate limited on the `auth` tier by IP.
 *
 * Account lockout already protects a single account from being guessed. It does
 * nothing about one client trying one password against many usernames, because
 * that never trips any individual account's counter. The per-IP limit is what
 * covers that case.
 */
export const POST = publicRoute(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const result = await authenticate(parsed.data.username, parsed.data.password, requestMetadata(request));
    const response = NextResponse.json({
      data: {
        user: {
          id: result.claims.userId,
          name: result.claims.name,
          username: result.claims.username,
          role: result.claims.role
        },
        forcePasswordChange: false
      }
    });
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: Math.floor(SESSION_IDLE_MS / 1000)
    });
    logger.info("auth.login", { userId: result.claims.userId, role: result.claims.role });
    return response;
  } catch (error) {
    // The username is deliberately not logged on failure: a log of attempted
    // usernames is a list of guesses, and on a typo it is a near-miss of a real
    // credential. The authentication_events table already records the attempt
    // with its username for audit, behind access control.
    logger.warn("auth.login_failed", {
      reason: error instanceof Error ? error.message : "unknown"
    });
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Login failed."
    }, { status });
  }
}, { rateLimit: "auth" });
