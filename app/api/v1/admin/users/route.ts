import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createOrganizationUser,
  listOrganizationUsers
} from "@/lib/admin-users";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { logger, reportError } from "@/lib/observability/logger";
import { queueWelcomeNotification } from "@/lib/notifications";
import { dispatchNotificationDelivery } from "@/lib/workflows/trigger";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(1),
  role: z.enum(["admin", "member"]).default("member")
});

export const GET = guard(async (_request, { session }) => {
  return NextResponse.json({ data: await listOrganizationUsers(session.organizationId) });
}, { admin: true });

/** `auth` tier: this creates a credential, so it belongs with the other ones. */
export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const result = await createOrganizationUser({
    ...parsed.data,
    role: parsed.data.role ?? "member",
    actorId: session.userId,
    organizationId: session.organizationId
  });
  try {
    const welcome = await queueWelcomeNotification({
      organizationId: session.organizationId,
      recipientUserId: result.user.id,
      name: result.user.name,
      email: result.user.email,
      initialPassword: parsed.data.password
    });
    if (welcome.queued) await dispatchNotificationDelivery(welcome.id);
  } catch (error) {
    // The account transaction has already committed. The admin must receive a
    // successful create response even if notification infrastructure is down.
    reportError("notification.welcome_dispatch_failed", error, {
      actorId: session.userId,
      userId: result.user.id
    });
  }
  logger.info("admin.user_created", {
    actorId: session.userId,
    role: parsed.data.role ?? "member"
  });
  return NextResponse.json({ data: result }, { status: 201 });
}, { admin: true, rateLimit: "auth" });
