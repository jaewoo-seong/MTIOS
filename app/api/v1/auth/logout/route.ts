import { NextResponse } from "next/server";
import {
  currentSession,
  revokeSession,
  SESSION_COOKIE
} from "@/lib/auth";
import { publicRoute } from "@/lib/api/guard";
import { logger } from "@/lib/observability/logger";

/**
 * Not guarded on purpose, and this is the one route where that is the safer
 * choice: logging out must clear the cookie even when the session behind it is
 * already revoked or expired. Under `guard` those cases return 401 before the
 * handler runs, leaving a stale cookie in the browser and a user who cannot
 * visibly log out.
 *
 * It authenticates internally instead - the session lookup below is what
 * decides whether there is anything to revoke - so nothing here is reachable
 * without a valid cookie.
 */
export const POST = publicRoute(async () => {
  const session = await currentSession({ allowPasswordChange: true }).catch(() => null);
  if (session) {
    await revokeSession(session.sessionId);
    logger.info("auth.logout", { userId: session.userId });
  }
  const response = NextResponse.json({ data: { loggedOut: true } });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}, { rateLimit: "auth" });
