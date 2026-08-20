import { NextResponse } from "next/server";
import {
  AuthError,
  refreshSession,
  SESSION_COOKIE,
  SESSION_IDLE_MS
} from "@/lib/auth";
import { publicRoute } from "@/lib/api/guard";

/**
 * Authenticates internally rather than through `guard`, because `refreshSession`
 * both verifies the session against the database and rotates its token. Running
 * `guard`'s check first would verify the same session twice per poll, and the
 * client polls this on an interval.
 *
 * Rate limited on the `auth` tier because this is the endpoint that mints a
 * fresh token, so it is the one worth bounding if a cookie is being replayed.
 */
export const GET = publicRoute(async () => {
  try {
    const session = await refreshSession();
    const response = NextResponse.json({
      data: {
        user: {
          id: session.claims.userId,
          name: session.claims.name,
          username: session.claims.username,
          role: session.claims.role
        },
        forcePasswordChange: false
      }
    });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_IDLE_MS / 1000)
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "unauthorized"
    }, { status: error instanceof AuthError ? error.status : 401 });
  }
}, { rateLimit: "auth" });
