import { verify } from "@node-rs/argon2";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashPassword,
  parseSession,
  serializeSession,
  validatePassword,
  verifySessionToken
} from "@/lib/auth";
import { quotaWindow } from "@/lib/ai/usage";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

describe("authentication and quota windows", () => {
  const previousSecret = process.env.AUTH_SESSION_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previousSecret;
  });

  it("hashes passwords with Argon2 and never stores plaintext", async () => {
    const password = "Temporary-Password-42";
    const encoded = await hashPassword(password);
    expect(encoded).not.toContain(password);
    expect(encoded.startsWith("$argon2")).toBe(true);
    expect(await verify(encoded, password)).toBe(true);
  });

  it("enforces password policy", () => {
    expect(() => validatePassword("short")).toThrow();
    expect(() => validatePassword("letters-only-password")).toThrow();
    expect(() => validatePassword("Strong-password-42")).not.toThrow();
  });

  it("signs session claims and rejects tampering or expiry", () => {
    process.env.AUTH_SESSION_SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
    const claims = {
      sessionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      organizationId: MTI_ORGANIZATION_ID,
      role: "admin" as const,
      name: "Operator",
      username: "operator",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: "test"
    };
    const token = serializeSession(claims);
    expect(parseSession(token)?.userId).toBe(claims.userId);
    expect(parseSession(`${token.slice(0, -1)}x`)).toBeNull();
    expect(parseSession(serializeSession({ ...claims, expiresAt: Date.now() - 1 }))).toBeNull();
  });

  it("verifySessionToken fails closed without a database, even for a validly signed token", async () => {
    // This is the exact bug middleware used to have: a signature-only check
    // accepts a token for its whole idle window regardless of logout, admin
    // revocation, or a password change, because none of those touch the
    // signature — only the `revoked_at` row does. verifySessionToken is the
    // single place both middleware and currentSession() now ask "is this
    // session still live," and it must never answer yes without consulting
    // the database that actually knows the answer.
    process.env.AUTH_SESSION_SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
    const token = serializeSession({
      sessionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      organizationId: MTI_ORGANIZATION_ID,
      role: "admin",
      name: "Operator",
      username: "operator",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      nonce: "test"
    });
    // No DATABASE_URL in this test environment, so `db` is null — verifying
    // this returns null (not the claims) proves the check fails closed.
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("verifySessionToken rejects missing, malformed, or tampered tokens", async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken(null)).toBeNull();
    expect(await verifySessionToken("not-a-real-token")).toBeNull();
  });

  it("computes timezone-aware daily and monthly reset boundaries", () => {
    const now = new Date("2026-07-29T14:00:00.000Z");
    const daily = quotaWindow("daily", "America/Indiana/Indianapolis", now);
    expect(daily.start.toISOString()).toBe("2026-07-29T04:00:00.000Z");
    expect(daily.end.toISOString()).toBe("2026-07-30T03:59:59.999Z");
    const monthly = quotaWindow("monthly", "Asia/Seoul", now);
    expect(monthly.start.toISOString()).toBe("2026-06-30T15:00:00.000Z");
    expect(monthly.end.toISOString()).toBe("2026-07-31T14:59:59.999Z");
  });
});
