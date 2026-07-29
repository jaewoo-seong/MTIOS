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

export const SESSION_COOKIE = "mti_session";
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

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

export function validatePassword(password: string) {
  if (password.length < 12 || password.length > 128) {
    throw new Error("Password must contain between 12 and 128 characters.");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("Password must contain at least one letter and one number.");
  }
}

type RequestMetadata = { ipAddress?: string | null; userAgent?: string | null };

export async function authenticate(
  username: string,
  password: string,
  metadata: RequestMetadata = {}
) {
  const database = requireDatabase();
  const normalizedUsername = normalizeUsername(username);
  const [account] = await database.select({
    user: users,
    role: memberships.role
  }).from(users).innerJoin(memberships, and(
    eq(memberships.userId, users.id),
    eq(memberships.organizationId, MTI_ORGANIZATION_ID)
  )).where(eq(users.username, normalizedUsername)).limit(1);

  const now = new Date();
  const railwayAdminPassword = normalizedUsername === normalizeUsername(process.env.ADMIN_USERNAME ?? "") &&
    account?.user.id === "00000000-0000-4000-8000-000000000002"
    ? process.env.ADMIN_PASSWORD
    : null;
  const accepted = account?.user.status === "active" &&
    (!account.user.lockedUntil || account.user.lockedUntil <= now) &&
    (railwayAdminPassword
      ? safeEqual(password, railwayAdminPassword)
      : Boolean(account.user.passwordHash) &&
        await verify(String(account.user.passwordHash), password).catch(() => false));
  if (!accepted) {
    if (account?.user) {
      const attempts = account.user.failedLoginAttempts + 1;
      await database.update(users).set({
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= LOCK_ATTEMPTS ? new Date(Date.now() + LOCK_MS) : account.user.lockedUntil,
        updatedAt: now
      }).where(eq(users.id, account.user.id));
    }
    await recordAuthEvent({
      userId: account?.user.id ?? null,
      username: normalizedUsername,
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
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: now,
      updatedAt: now
    }).where(eq(users.id, account.user.id));
  });
  await recordAuthEvent({
    userId: account.user.id, username: normalizedUsername, event: "login",
    success: true, ...metadata
  });
  return { token, claims };
}

export async function currentSession(options: { admin?: boolean; allowPasswordChange?: boolean } = {}) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const claims = parseSession(token);
  if (!claims || !token || !db) throw new AuthError("unauthorized", 401);
  const [session] = await db.select().from(userSessions).where(and(
    eq(userSessions.id, claims.sessionId),
    eq(userSessions.tokenHash, digest(token)),
    isNull(userSessions.revokedAt),
    gt(userSessions.idleExpiresAt, new Date()),
    gt(userSessions.absoluteExpiresAt, new Date())
  )).limit(1);
  if (!session) throw new AuthError("unauthorized", 401);
  if (options.admin && claims.role !== "admin") throw new AuthError("forbidden", 403);
  return claims;
}

export async function refreshSession() {
  const claims = await currentSession({ allowPasswordChange: true });
  const database = requireDatabase();
  const [session] = await database.select().from(userSessions)
    .where(eq(userSessions.id, claims.sessionId)).limit(1);
  if (!session || session.revokedAt) throw new AuthError("unauthorized", 401);
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
  return { token, claims: nextClaims };
}

export async function changePassword(currentPassword: string, newPassword: string) {
  validatePassword(newPassword);
  const session = await currentSession({ allowPasswordChange: true });
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
    organizationId: input.userId ? MTI_ORGANIZATION_ID : null,
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

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

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
