import { schedules, task } from "@trigger.dev/sdk";
import { deliverDueNotifications, deliverNotification } from "@/lib/notifications";

export const emailNotificationDelivery = task({
  id: "email-notification-delivery",
  maxDuration: 120,
  retry: {
    maxAttempts: 5,
    minTimeoutInMs: 60_000,
    maxTimeoutInMs: 3_600_000,
    factor: 2,
    randomize: true
  },
  run: ({ notificationId }: { notificationId: string }) => deliverNotification(notificationId)
});

export const emailNotificationOutboxSweep = schedules.task({
  id: "email-notification-outbox-sweep",
  cron: { pattern: "*/1 * * * *", environments: ["PRODUCTION"] },
  maxDuration: 120,
  run: () => deliverDueNotifications(100)
});
