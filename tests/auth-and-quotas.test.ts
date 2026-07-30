import { verify } from "@node-rs/argon2";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashPassword,
  parseSession,
  serializeSession,
  SESSION_IDLE_MS,
  SESSION_ROTATE_AFTER_MS,
  shouldRotateSession,
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

describe("session refresh rotation", () => {
  const previousSecret = process.env.AUTH_SESSION_SECRET;
  afterEach(() => {
    if (previousSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previousSecret;
  });

  const now = Date.UTC(2026, 6, 30, 12, 0, 0);

  it("does not rotate while the session is in the front half of its window", () => {
    // A freshly issued session has a full idle window ahead of it.
    expect(shouldRotateSession(now + SESSION_IDLE_MS, now)).toBe(false);
    // Still comfortably live an hour later.
    expect(shouldRotateSession(now + SESSION_IDLE_MS - 60 * 60 * 1000, now)).toBe(false);
  });

  it("rotates once the remaining window falls to half or below", () => {
    expect(shouldRotateSession(now + SESSION_ROTATE_AFTER_MS, now)).toBe(true);
    expect(shouldRotateSession(now + SESSION_ROTATE_AFTER_MS - 1, now)).toBe(true);
    expect(shouldRotateSession(now, now)).toBe(true);
    // A session already past its claim expiry must rotate rather than be
    // handed back unchanged.
    expect(shouldRotateSession(now - 1000, now)).toBe(true);
  });

  it("keeps a cookie valid for sibling requests issued around a refresh", () => {
    // The bug this guards: the client loads several endpoints in parallel and
    // polls the session endpoint among them. When that poll rotated the token,
    // every sibling still carrying the previous cookie failed its tokenHash
    // match and returned 401 — visible as an "unauthorized" toast on almost
    // every page load.
    process.env.AUTH_SESSION_SECRET = "session-rotation-race-secret-at-least-32-chars";
    const claims = {
      sessionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      organizationId: MTI_ORGANIZATION_ID,
      role: "admin" as const,
      name: "Operator",
      username: "operator",
      issuedAt: now,
      expiresAt: now + SESSION_IDLE_MS,
      nonce: "fixed-nonce"
    };
    const cookie = serializeSession(claims);

    // A refresh this early in the window must hand back the same token, so a
    // concurrent request presenting `cookie` still matches what is stored.
    expect(shouldRotateSession(claims.expiresAt, now)).toBe(false);
    expect(parseSession(cookie)).toMatchObject({ sessionId: claims.sessionId });

    // Rotation changes the token, which is why it must be rare rather than
    // per-request: any request already in flight with the old cookie loses.
    const rotated = serializeSession({
      ...claims,
      issuedAt: now + SESSION_ROTATE_AFTER_MS,
      expiresAt: now + SESSION_ROTATE_AFTER_MS + SESSION_IDLE_MS,
      nonce: "rotated-nonce"
    });
    expect(rotated).not.toBe(cookie);
  });
});
