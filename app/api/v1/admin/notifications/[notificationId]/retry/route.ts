import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { notFound } from "@/lib/http";
import { retryNotification } from "@/lib/notifications";
import { dispatchNotificationDelivery } from "@/lib/workflows/trigger";

export const POST = guard<{ notificationId: string }>(async (_request, { params }) => {
  const notification = await retryNotification(params.notificationId);
  if (!notification) return notFound("notification");
  // A prior Trigger.dev run used the stable initial-delivery key. A manual
  // retry needs a fresh key or Trigger may return the old run during its
  // idempotency window; the outbox claim still prevents concurrent sends.
  await dispatchNotificationDelivery(notification.id, `notification:${notification.id}:manual:${Date.now()}`);
  return NextResponse.json({ data: { retried: true } });
}, { admin: true });
