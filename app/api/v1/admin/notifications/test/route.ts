import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { queueTestNotification } from "@/lib/notifications";
import { dispatchNotificationDelivery } from "@/lib/workflows/trigger";

const schema = z.object({ email: z.string().trim().email().max(254) });

export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const notification = await queueTestNotification(parsed.data.email, session.userId);
  const delivery = await dispatchNotificationDelivery(notification.id);
  return NextResponse.json({ data: { notificationId: notification.id, delivery } }, { status: 202 });
}, { admin: true, rateLimit: "auth" });
