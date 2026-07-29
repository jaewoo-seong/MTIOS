import { NextResponse } from "next/server";
import {
  AuthError,
  refreshSession,
  SESSION_COOKIE,
  SESSION_IDLE_MS
} from "@/lib/auth";

export async function GET() {
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
      sameSite: "strict",
      path: "/",
      maxAge: Math.floor(SESSION_IDLE_MS / 1000)
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "unauthorized"
    }, { status: error instanceof AuthError ? error.status : 401 });
  }
}
