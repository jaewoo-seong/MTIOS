import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  changePassword,
  SESSION_COOKIE
} from "@/lib/auth";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { logger } from "@/lib/observability/logger";

const schema = z.object({
  currentPassword: z.string(),
  newPassword: z.string()
});

/**
 * Rate limited on the `auth` tier rather than `standard`: the current password
 * is a credential, and an unbounded endpoint that verifies one is a guessing
 * oracle regardless of how well the rest of the flow behaves.
 */
export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    await changePassword(parsed.data.currentPassword, parsed.data.newPassword, session);
    logger.info("auth.password_changed", { userId: session.userId });
    const response = NextResponse.json({ data: { changed: true, loginRequired: true } });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Password could not be changed."
    }, { status: error instanceof AuthError ? error.status : 400 });
  }
}, { rateLimit: "auth" });
