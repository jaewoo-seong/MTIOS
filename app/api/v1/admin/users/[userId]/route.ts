import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, currentSession } from "@/lib/auth";
import { updateOrganizationUser } from "@/lib/admin-users";
import { parseJson } from "@/lib/http";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional()
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const actor = await currentSession({ admin: true });
    const { userId } = await context.params;
    return NextResponse.json({
      data: await updateOrganizationUser({ userId, actorId: actor.userId, ...parsed.data })
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Request failed."
    }, { status: error instanceof AuthError ? error.status : 400 });
  }
}
