import { NextResponse } from "next/server";
import { z } from "zod";
import { updateOrganizationUser } from "@/lib/admin-users";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { logger } from "@/lib/observability/logger";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  emailNotificationsEnabled: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0);

export const PATCH = guard<{ userId: string }>(async (request, { params, session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const result = await updateOrganizationUser({
    userId: params.userId,
    actorId: session.userId,
    organizationId: session.organizationId,
    name: parsed.data.name,
    email: parsed.data.email,
    role: parsed.data.role,
    status: parsed.data.status,
    emailNotificationsEnabled: parsed.data.emailNotificationsEnabled
  });
  // Role and status changes alter what an account can reach, so they are worth a
  // log line independent of the authentication_events audit trail.
  logger.info("admin.user_updated", {
    targetUserId: params.userId,
    actorId: session.userId,
    role: parsed.data.role ?? null,
    status: parsed.data.status ?? null
  });
  return NextResponse.json({ data: result });
}, { admin: true });
