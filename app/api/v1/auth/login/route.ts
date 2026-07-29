import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticate,
  AuthError,
  requestMetadata,
  SESSION_COOKIE,
  SESSION_IDLE_MS
} from "@/lib/auth";
import { parseJson } from "@/lib/http";

const schema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128)
});

export async function POST(request: Request) {
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
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Login failed."
    }, { status });
  }
}
