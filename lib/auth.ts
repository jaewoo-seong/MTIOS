import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, requireDatabase } from "@/lib/db/client";
import {
  authenticationEvents,
  memberships,
  userSessions,
  users
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";
import { isUiAuditMode, uiAuditClaims } from "@/lib/ui-audit-mode";

export const SESSION_COOKIE = "mti_session";
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionRole = "admin" | "member";
export type SessionClaims = {
  sessionId: string;
  userId: string;
  organizationId: string;
  role: SessionRole;
  name: string;
  username: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function secret() {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters.");
  return value;
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function serializeSession(claims: SessionClaims) {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

export function parseSession(value: string | undefined | null): SessionClaims | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (claims.organizationId !== MTI_ORGANIZATION_ID || claims.expiresAt <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  return hash(password, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32
  });
}

type RequestMetadata = { ipAddress?: string | null; userAgent?: string | null };

export async function authenticate(
  identifier: string,
  password: string,
  metadata: RequestMetadata = {}
) {
  const database = requireDatabase();
  const normalizedIdentifier = normalizeLoginIdentifier(identifier);
  const operatorUsername = normalizeLoginIdentifier(process.env.ADMIN_USERNAME ?? "");
  const isOperatorIdentifier = normalizedIdentifier === operatorUsername;
  const [account] = await database.select({
    user: users,
    role: memberships.role
  }).from(users).innerJoin(memberships, and(
    eq(memberships.userId, users.id),
    eq(memberships.organizationId, MTI_ORGANIZATION_ID)
  )).where(isOperatorIdentifier
    ? and(eq(users.id, "00000000-0000-4000-8000-000000000002"), eq(users.username, normalizedIdentifier))
    : eq(users.email, normalizedIdentifier)
  ).limit(1);

  const now = new Date();
  const isRailwayAdmin = isOperatorIdentifier &&
    account?.user.id === "00000000-0000-4000-8000-000000000002";
  const railwayAdminPassword = isRailwayAdmin
    ? process.env.ADMIN_PASSWORD
    : undefined;
  // The Railway break-glass operator remains the sole username-based login.
  // Every normal account is found by its normalized email address and verifies
  // the password hash stored for that user.
  const passwordMatches = railwayAdminPassword !== undefined
    ? safeEqual(password, railwayAdminPassword)
    : account?.user.passwordHash
      ? await verify(String(account.user.passwordHash), password).catch(() => false)
      : false;
  const accepted = account?.user.status === "active" && passwordMatches;
  if (!accepted) {
    await recordAuthEvent({
      userId: account?.user.id ?? null,
      username: normalizedIdentifier,
      email: isOperatorIdentifier ? null : normalizedIdentifier,
      event: "login",
      success: false,
      ...metadata
    });
    throw new Error("Invalid username or password.");
  }

  const sessionId = crypto.randomUUID();
  const claims: SessionClaims = {
    sessionId,
    userId: account.user.id,
    organizationId: MTI_ORGANIZATION_ID,
    role: account.role === "admin" || account.role === "owner" ? "admin" : "member",
    name: account.user.name,
    username: account.user.username,
    issuedAt: Date.now(),
    expiresAt: Date.now() + SESSION_IDLE_MS,
    nonce: randomBytes(18).toString("base64url")
  };
  const token = serializeSession(claims);
  await database.transaction(async (tx) => {
    await tx.insert(userSessions).values({
      id: sessionId,
      organizationId: MTI_ORGANIZATION_ID,
      userId: account.user.id,
      tokenHash: digest(token),
      idleExpiresAt: new Date(claims.expiresAt),
      absoluteExpiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null
    });
    await tx.update(users).set({
      lastLoginAt: now,
      updatedAt: now
    }).where(eq(users.id, account.user.id));
  });
  await recordAuthEvent({
    userId: account.user.id, username: normalizedIdentifier,
    email: account.user.email, event: "login",
    success: true, ...metadata
  });
  return { token, claims };
}

/**
 * The single source of truth for "is this cookie still a live session" —
 * checked against the database, not just the HMAC signature. A signature-only
 * check (the old middleware behavior) accepts a token for up to its 12h idle
 * window even after logout, admin revocation, or a password change, because
 * none of those rewrite the signature, only the `revoked_at` column.
 *
 * Callable from Node.js middleware and from route handlers alike, so there is
 * exactly one place session validity is decided.
 */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionClaims | null> {
  const claims = parseSession(token ?? null);
  if (!claims || !token || !db) return null;
  const [session] = await db.select().from(userSessions).where(and(
    eq(userSessions.id, claims.sessionId),
    eq(userSessions.tokenHash, digest(token)),
    isNull(userSessions.revokedAt),
    gt(userSessions.idleExpiresAt, new Date()),
    gt(userSessions.absoluteExpiresAt, new Date())
  )).limit(1);
  return session ? claims : null;
}

export async function currentSession(options: { admin?: boolean; allowPasswordChange?: boolean } = {}) {
  if (isUiAuditMode()) return uiAuditClaims();
  const cookieStore = await cookies();
  const claims = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!claims) throw new AuthError("unauthorized", 401);
  if (options.admin && claims.role !== "admin") throw new AuthError("forbidden", 403);
  return claims;
}

/**
 * Rotating on every poll is what made concurrent requests fail. The client
 * loads several endpoints in parallel and polls this one among them; the
 * moment a rotation lands, every sibling request still carrying the previous
 * cookie fails its `tokenHash` match and comes back 401. The reads retry and
 * succeed, so nothing breaks - but the app reports "unauthorized" on
 * essentially every page load, which teaches an operator to ignore the one
 * message that should never be ignored.
 *
 * Rotating only in the back half of the idle window keeps the security
 * properties that matter - a bounded token lifetime and a fresh nonce - while
 * reducing rotations from "every few seconds" to at most one per six hours.
 *
 * It narrows the race rather than closing it: a rotation that does happen
 * still invalidates in-flight requests holding the old cookie. Closing it
 * entirely means honouring the previous token for a few seconds after
 * rotation, which needs a column to remember it in.
 */
export const SESSION_ROTATE_AFTER_MS = SESSION_IDLE_MS / 2;

export function shouldRotateSession(claimsExpiresAt: number, now = Date.now()) {
  return claimsExpiresAt - now <= SESSION_ROTATE_AFTER_MS;
}

export async function refreshSession() {
  if (isUiAuditMode()) {
    return { token: "ui-audit-local-only", claims: uiAuditClaims(), rotated: false };
  }
  const cookieStore = await cookies();
  const currentToken = cookieStore.get(SESSION_COOKIE)?.value;
  const claims = await currentSession({ allowPasswordChange: true });
  const database = requireDatabase();
  const [session] = await database.select().from(userSessions)
    .where(eq(userSessions.id, claims.sessionId)).limit(1);
  if (!session || session.revokedAt) throw new AuthError("unauthorized", 401);

  // Early in the window, prove liveness without invalidating the cookie any
  // sibling request is currently using. `idleExpiresAt` is deliberately left
  // alone: it must keep matching the `expiresAt` claim inside the token, or
  // the two expiry checks in verifySessionToken would disagree.
  if (currentToken && !shouldRotateSession(claims.expiresAt)) {
    await database.update(userSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(userSessions.id, claims.sessionId));
    return { token: currentToken, claims, rotated: false };
  }

  const expiresAt = Math.min(
    Date.now() + SESSION_IDLE_MS,
    session.absoluteExpiresAt.getTime()
  );
  const nextClaims: SessionClaims = {
    ...claims,
    issuedAt: Date.now(),
    expiresAt,
    nonce: randomBytes(18).toString("base64url")
  };
  const token = serializeSession(nextClaims);
  await database.update(userSessions).set({
    tokenHash: digest(token),
    lastSeenAt: new Date(),
    idleExpiresAt: new Date(expiresAt)
  }).where(eq(userSessions.id, claims.sessionId));
  return { token, claims: nextClaims, rotated: true };
}

/**
 * `existing` lets a caller that has already verified the session pass it in,
 * so a guarded route does not pay for a second database round trip to
 * re-establish what it just established.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  existing?: SessionClaims
) {
  const session = existing ?? await currentSession({ allowPasswordChange: true });
  if (session.role === "admin" && session.userId === "00000000-0000-4000-8000-000000000002") {
    throw new AuthError("Admin credentials are managed in Railway.", 400);
  }
  const database = requireDatabase();
  const [account] = await database.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!account?.passwordHash || !await verify(account.passwordHash, currentPassword).catch(() => false)) {
    throw new AuthError("Current password is incorrect.", 400);
  }
  const now = new Date();
  await database.transaction(async (tx) => {
    await tx.update(users).set({
      passwordHash: await hashPassword(newPassword),
      passwordChangedAt: now,
      updatedAt: now
    }).where(eq(users.id, session.userId));
    await tx.update(userSessions).set({ revokedAt: now }).where(and(
      eq(userSessions.userId, session.userId),
      isNull(userSessions.revokedAt)
    ));
  });
  await recordAuthEvent({
    userId: session.userId, username: session.username, event: "password_changed", success: true
  });
}

export async function revokeSession(sessionId: string) {
  if (!db) return;
  await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, sessionId));
}

export async function revokeUserSessions(userId: string) {
  const database = requireDatabase();
  await database.update(userSessions).set({ revokedAt: new Date() }).where(and(
    eq(userSessions.userId, userId),
    isNull(userSessions.revokedAt)
  ));
}

export async function recordAuthEvent(input: {
  organizationId?: string | null;
  userId?: string | null;
  username?: string | null;
  email?: string | null;
  event: string;
  success: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!db) return;
  await db.insert(authenticationEvents).values({
    organizationId: input.organizationId ?? (input.userId ? MTI_ORGANIZATION_ID : null),
    userId: input.userId ?? null,
    username: input.username ?? null,
    email: input.email ?? null,
    event: input.event,
    success: input.success,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? {}
  });
}

export function normalizeLoginIdentifier(value: string) {
  return value.trim().toLowerCase();
}

/** Backwards-compatible name for callers that normalize the operator username. */
export const normalizeUsername = normalizeLoginIdentifier;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function requestMetadata(request: Request): RequestMetadata {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent")
  };
}

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
