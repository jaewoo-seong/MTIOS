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
  username: z.string().trim().min(1).max(254),
  password: z.string()
});

/**
 * Public by necessity. The operator explicitly requires unlimited password
 * attempts, so this route opts out of both account lockout and request limits.
 * Failed attempts are still written to the authentication audit trail.
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
}, { rateLimit: false });
