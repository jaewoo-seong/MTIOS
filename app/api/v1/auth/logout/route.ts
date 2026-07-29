import { NextResponse } from "next/server";
import {
  currentSession,
  revokeSession,
  SESSION_COOKIE
} from "@/lib/auth";

export async function POST() {
  const session = await currentSession({ allowPasswordChange: true }).catch(() => null);
  if (session) await revokeSession(session.sessionId);
  const response = NextResponse.json({ data: { loggedOut: true } });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
  return response;
}
