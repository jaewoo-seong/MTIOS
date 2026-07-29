import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, AuthError } from "@/lib/auth";
import {
  createOrganizationUser,
  listOrganizationUsers
} from "@/lib/admin-users";
import { parseJson } from "@/lib/http";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "member"]).default("member")
});

export async function GET() {
  try {
    await currentSession({ admin: true });
    return NextResponse.json({ data: await listOrganizationUsers() });
  } catch (error) {
    return authResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const actor = await currentSession({ admin: true });
    return NextResponse.json({
      data: await createOrganizationUser({
        ...parsed.data,
        role: parsed.data.role ?? "member",
        actorId: actor.userId
      })
    }, { status: 201 });
  } catch (error) {
    return authResponse(error);
  }
}

function authResponse(error: unknown) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Request failed."
  }, { status: error instanceof AuthError ? error.status : 400 });
}
