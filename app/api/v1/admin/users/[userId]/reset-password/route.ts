import { NextResponse } from "next/server";
import { AuthError, currentSession } from "@/lib/auth";
import { resetOrganizationUserPassword } from "@/lib/admin-users";
import { parseJson } from "@/lib/http";
import { z } from "zod";

const schema = z.object({ password: z.string().min(12).max(128) });

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const actor = await currentSession({ admin: true });
    const { userId } = await context.params;
    return NextResponse.json({
      data: await resetOrganizationUserPassword(userId, actor.userId, parsed.data.password)
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Request failed."
    }, { status: error instanceof AuthError ? error.status : 400 });
  }
}
