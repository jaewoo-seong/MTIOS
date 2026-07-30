import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createOrganizationUser,
  listOrganizationUsers
} from "@/lib/admin-users";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { logger } from "@/lib/observability/logger";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(12).max(128),
  role: z.enum(["admin", "member"]).default("member")
});

export const GET = guard(async () => {
  return NextResponse.json({ data: await listOrganizationUsers() });
}, { admin: true });

/** `auth` tier: this creates a credential, so it belongs with the other ones. */
export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const result = await createOrganizationUser({
    ...parsed.data,
    role: parsed.data.role ?? "member",
    actorId: session.userId
  });
  logger.info("admin.user_created", {
    actorId: session.userId,
    role: parsed.data.role ?? "member"
  });
  return NextResponse.json({ data: result }, { status: 201 });
}, { admin: true, rateLimit: "auth" });
