import { NextResponse } from "next/server";
import { AuthError, currentSession } from "@/lib/auth";
import { resetOrganizationUserPassword } from "@/lib/admin-users";

export async function POST(_: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const actor = await currentSession({ admin: true });
    const { userId } = await context.params;
    return NextResponse.json({
      data: await resetOrganizationUserPassword(userId, actor.userId)
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Request failed."
    }, { status: error instanceof AuthError ? error.status : 400 });
  }
}
