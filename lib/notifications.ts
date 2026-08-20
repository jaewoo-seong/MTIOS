import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import { notificationOutbox, reports, users } from "@/lib/db/schema";
import { sendServiceEmail } from "@/lib/gmail";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export type NotificationEventType = "report.ready" | "system.test";

export async function queueNotification(input: {
  recipientUserId: string;
  eventType: NotificationEventType;
  dedupeKey: string;
  sourceType?: string;
  sourceId?: string;
  subject: string;
  bodyText: string;
}) {
  const db = requireDatabase();
  const [recipient] = await db.select({
    id: users.id,
    email: users.email,
    username: users.username,
    status: users.status,
    enabled: users.emailNotificationsEnabled
  }).from(users).where(eq(users.id, input.recipientUserId)).limit(1);
  const address = recipient?.email ?? (recipient?.username.includes("@") ? recipient.username : null);
  if (!recipient || recipient.status !== "active" || !recipient.enabled || !address) {
    return { queued: false as const, reason: "recipient_unavailable" as const };
  }
  const [row] = await db.insert(notificationOutbox).values({
    organizationId: MTI_ORGANIZATION_ID,
    recipientUserId: recipient.id,
    eventType: input.eventType,
    dedupeKey: input.dedupeKey,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    toAddress: address,
    subject: input.subject,
    bodyText: input.bodyText
  }).onConflictDoNothing({ target: notificationOutbox.dedupeKey }).returning({ id: notificationOutbox.id });
  return row ? { queued: true as const, id: row.id } : { queued: false as const, reason: "duplicate" as const };
}

export async function queueReportReadyNotification(reportId: string) {
  const db = requireDatabase();
  const [report] = await db.select().from(reports).where(and(
    eq(reports.id, reportId),
    eq(reports.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  if (!report?.createdBy || report.status !== "review") {
    return { queued: false as const, reason: "report_not_notifiable" as const };
  }
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return queueNotification({
    recipientUserId: report.createdBy,
    eventType: "report.ready",
    dedupeKey: `report.ready:${report.id}:${report.createdBy}`,
    sourceType: "report",
    sourceId: report.id,
    subject: `Report ready: ${report.title}`,
    bodyText: [
      "Your MTI Business OS report is ready.",
      "",
      report.title,
      report.summary || "No summary was provided.",
      "",
      `Open report: ${base}/reports/${report.id}`,
      "",
      "This is an automated notification from MTI Business OS."
    ].join("\n")
  });
}

export async function queueTestNotification(toAddress: string, actorId: string) {
  const db = requireDatabase();
  const now = new Date();
  const [row] = await db.insert(notificationOutbox).values({
    organizationId: MTI_ORGANIZATION_ID,
    recipientUserId: actorId,
    eventType: "system.test",
    dedupeKey: `system.test:${actorId}:${now.getTime()}:${crypto.randomUUID()}`,
    sourceType: "system",
    toAddress: toAddress.trim().toLowerCase(),
    subject: "MTI Business OS email test",
    bodyText: [
      "The MTI Business OS Gmail service sender is working.",
      "",
      `Sent at: ${now.toISOString()}`,
      "This is an automated test notification."
    ].join("\n")
  }).returning({ id: notificationOutbox.id });
  return { queued: true as const, id: row.id };
}

export async function retryNotification(notificationId: string) {
  const db = requireDatabase();
  const [row] = await db.update(notificationOutbox).set({
    status: "queued",
    nextAttemptAt: new Date(),
    lastError: null,
    updatedAt: new Date()
  }).where(and(
    eq(notificationOutbox.id, notificationId),
    eq(notificationOutbox.organizationId, MTI_ORGANIZATION_ID),
    inArray(notificationOutbox.status, ["failed", "queued"]),
    sql`${notificationOutbox.attempts} < ${notificationOutbox.maxAttempts}`
  )).returning({ id: notificationOutbox.id });
  return row ?? null;
}

export async function deliverNotification(notificationId: string) {
  const db = requireDatabase();
  const now = new Date();
  const staleClaim = new Date(now.getTime() - 10 * 60_000);
  const [claimed] = await db.update(notificationOutbox).set({
    status: "sending",
    attempts: sql`${notificationOutbox.attempts} + 1`,
    lastError: null,
    updatedAt: now
  }).where(and(
    eq(notificationOutbox.id, notificationId),
    eq(notificationOutbox.organizationId, MTI_ORGANIZATION_ID),
    or(
      and(
        inArray(notificationOutbox.status, ["queued", "failed"]),
        lte(notificationOutbox.nextAttemptAt, now)
      ),
      and(
        eq(notificationOutbox.status, "sending"),
        lte(notificationOutbox.updatedAt, staleClaim)
      )
    ),
    sql`${notificationOutbox.attempts} < ${notificationOutbox.maxAttempts}`
  )).returning();
  if (!claimed) return { delivered: false as const, reason: "not_available" as const };
  try {
    const sent = await sendServiceEmail({
      to: claimed.toAddress,
      subject: claimed.subject,
      bodyText: claimed.bodyText
    });
    await db.update(notificationOutbox).set({
      status: "sent",
      gmailConnectionId: sent.gmailConnectionId,
      gmailMessageId: sent.gmailMessageId,
      sentAt: new Date(),
      updatedAt: new Date()
    }).where(eq(notificationOutbox.id, claimed.id));
    return { delivered: true as const, id: claimed.id, gmailMessageId: sent.gmailMessageId };
  } catch (error) {
    const delayMinutes = Math.min(60, 2 ** Math.max(0, claimed.attempts - 1));
    await db.update(notificationOutbox).set({
      status: "failed",
      lastError: safeError(error),
      nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
      updatedAt: new Date()
    }).where(eq(notificationOutbox.id, claimed.id));
    throw error;
  }
}

/**
 * Replays due rows from the durable outbox. This is deliberately independent
 * of the request that created the notification: if dispatching that request's
 * Trigger.dev task fails, the scheduled sweeper still delivers the message.
 */
export async function deliverDueNotifications(limit = 50) {
  const db = requireDatabase();
  const now = new Date();
  const staleClaim = new Date(now.getTime() - 10 * 60_000);
  const candidates = await db.select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(and(
      eq(notificationOutbox.organizationId, MTI_ORGANIZATION_ID),
      sql`${notificationOutbox.attempts} < ${notificationOutbox.maxAttempts}`,
      or(
        and(
          inArray(notificationOutbox.status, ["queued", "failed"]),
          lte(notificationOutbox.nextAttemptAt, now)
        ),
        and(
          eq(notificationOutbox.status, "sending"),
          lte(notificationOutbox.updatedAt, staleClaim)
        )
      )
    ))
    .orderBy(notificationOutbox.nextAttemptAt)
    .limit(Math.max(1, Math.min(200, limit)));
  const results = await Promise.allSettled(candidates.map(({ id }) => deliverNotification(id)));
  return {
    considered: candidates.length,
    delivered: results.filter((result) => result.status === "fulfilled" && result.value.delivered).length,
    failed: results.filter((result) => result.status === "rejected").length
  };
}

export async function listNotifications(limit = 100) {
  const db = requireDatabase();
  return db.select({
    id: notificationOutbox.id,
    eventType: notificationOutbox.eventType,
    toAddress: notificationOutbox.toAddress,
    subject: notificationOutbox.subject,
    status: notificationOutbox.status,
    attempts: notificationOutbox.attempts,
    lastError: notificationOutbox.lastError,
    sentAt: notificationOutbox.sentAt,
    createdAt: notificationOutbox.createdAt
  }).from(notificationOutbox).where(eq(
    notificationOutbox.organizationId,
    MTI_ORGANIZATION_ID
  )).orderBy(desc(notificationOutbox.createdAt)).limit(Math.max(1, Math.min(500, limit)));
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "notification delivery failed";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
}
