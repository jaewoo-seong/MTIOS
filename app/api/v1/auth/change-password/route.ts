import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  changePassword,
  SESSION_COOKIE
} from "@/lib/auth";
import { parseJson } from "@/lib/http";

const schema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128)
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    await changePassword(parsed.data.currentPassword, parsed.data.newPassword);
    const response = NextResponse.json({ data: { changed: true, loginRequired: true } });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Password could not be changed."
    }, { status: error instanceof AuthError ? error.status : 400 });
  }
}
