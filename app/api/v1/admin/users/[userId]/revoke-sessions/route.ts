import { NextResponse } from "next/server";
import { AuthError, currentSession, revokeUserSessions } from "@/lib/auth";

export async function POST(_: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    await currentSession({ admin: true });
    const { userId } = await context.params;
    await revokeUserSessions(userId);
    return NextResponse.json({ data: { revoked: true } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Request failed."
    }, { status: error instanceof AuthError ? error.status : 400 });
  }
}
