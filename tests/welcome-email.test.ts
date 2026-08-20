import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWelcomeEmail,
  notificationBodyForDelivery,
  sealNotificationBody
} from "@/lib/notifications";

const encryptionKey = Buffer.alloc(32, 19).toString("base64");

beforeEach(() => {
  process.env.APP_URL = "https://app-production-201e.up.railway.app";
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = encryptionKey;
});

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
});

describe("account welcome email", () => {
  it("includes the normalized account, initial password, and production login link", () => {
    const message = createWelcomeEmail({
      name: "New User",
      email: " New.User@Example.COM ",
      initialPassword: "temporary-password"
    });

    expect(message.subject).toBe("Welcome to MTI Business OS");
    expect(message.bodyText).toContain("Hello New User,");
    expect(message.bodyText).toContain("Email: new.user@example.com");
    expect(message.bodyText).toContain("Initial password: temporary-password");
    expect(message.bodyText).toContain("Sign in: https://app-production-201e.up.railway.app/");
    expect(message.bodyText).toMatch(/change your password as soon as possible/i);
  });

  it("encrypts initial credentials while queued and decrypts only for delivery", () => {
    const plaintext = "Initial password: never-store-this-readable";
    const sealed = sealNotificationBody(plaintext);

    expect(sealed).toMatch(/^sealed:v1\./);
    expect(sealed).not.toContain("never-store-this-readable");
    expect(notificationBodyForDelivery(sealed)).toBe(plaintext);
  });

  it("continues to deliver existing non-sensitive plaintext notifications", () => {
    expect(notificationBodyForDelivery("A report is ready.")).toBe("A report is ready.");
  });
});
