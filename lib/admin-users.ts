import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import {
  authenticationEvents,
  memberships,
  userPreferences,
  users
} from "@/lib/db/schema";
import {
  AuthError,
  hashPassword,
  recordAuthEvent,
  revokeUserSessions
} from "@/lib/auth";
import { requireDatabase } from "@/lib/db/client";
import { MTI_OPERATOR_ID } from "@/lib/repository";

export async function listOrganizationUsers(organizationId: string) {
  const database = requireDatabase();
  const rows = await database.select({
    id: users.id,
    name: users.name,
    username: users.username,
    email: users.email,
    status: users.status,
    lastLoginAt: users.lastLoginAt,
    passwordChangedAt: users.passwordChangedAt,
    emailNotificationsEnabled: users.emailNotificationsEnabled,
    role: memberships.role,
    createdAt: users.createdAt
  }).from(users).innerJoin(memberships, and(
    eq(memberships.userId, users.id),
    eq(memberships.organizationId, organizationId)
  )).orderBy(users.name);
  const history = await database.select({
    id: authenticationEvents.id,
    userId: authenticationEvents.userId,
    username: authenticationEvents.username,
    event: authenticationEvents.event,
    success: authenticationEvents.success,
    ipAddress: authenticationEvents.ipAddress,
    createdAt: authenticationEvents.createdAt
  }).from(authenticationEvents)
    .where(eq(authenticationEvents.organizationId, organizationId))
    .orderBy(desc(authenticationEvents.createdAt))
    .limit(100);
  return { users: rows, history };
}

export async function createOrganizationUser(input: {
  name: string;
  email: string;
  password: string;
  role: "admin" | "member";
  actorId: string;
  organizationId: string;
}) {
  const database = requireDatabase();
  const email = normalizeEmailAddress(input.email);
  const passwordHash = await hashPassword(input.password);
  const created = await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`organization-user-email:${email}`}))`);
    const [duplicate] = await tx.select({ id: users.id }).from(users).where(or(
      eq(users.email, email),
      eq(users.username, email)
    )).limit(1);
    if (duplicate) throw new AuthError("An account with this email already exists.", 409);
    const [user] = await tx.insert(users).values({
      name: input.name.trim(),
      username: email,
      email,
      passwordHash,
      status: "active",
      forcePasswordChange: false,
      temporaryPasswordExpiresAt: null,
      passwordChangedAt: new Date()
    }).returning();
    await tx.insert(memberships).values({
      organizationId: input.organizationId,
      userId: user.id,
      role: input.role
    });
    await tx.insert(userPreferences).values({
      organizationId: input.organizationId,
      userId: user.id
    });
    return user;
  });
  await recordAuthEvent({
    userId: created.id,
    username: created.username,
    email: created.email,
    event: "account_created",
    success: true,
    metadata: { actorId: input.actorId, role: input.role },
    organizationId: input.organizationId
  });
  return {
    user: {
      id: created.id,
      name: created.name,
      username: created.username,
      email: created.email ?? email,
      role: input.role,
      status: created.status,
      forcePasswordChange: false
    }
  };
}

export async function updateOrganizationUser(input: {
  userId: string;
  actorId: string;
  organizationId: string;
  name?: string;
  email?: string;
  role?: "admin" | "member";
  status?: "active" | "disabled";
  emailNotificationsEnabled?: boolean;
}) {
  const database = requireDatabase();
  if (input.userId === MTI_OPERATOR_ID && (input.email || input.role === "member" || input.status === "disabled")) {
    throw new AuthError("Railway operator identity cannot be changed, demoted, or disabled.", 400);
  }
  const email = input.email ? normalizeEmailAddress(input.email) : undefined;
  await database.transaction(async (tx) => {
    if (email) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`organization-user-email:${email}`}))`);
    const [membership] = await tx.select({ id: memberships.id }).from(memberships).where(and(
      eq(memberships.organizationId, input.organizationId),
      eq(memberships.userId, input.userId)
    )).limit(1);
    if (!membership) throw new AuthError("User not found.", 404);
    if (email) {
      const [duplicate] = await tx.select({ id: users.id }).from(users).where(and(
        or(eq(users.email, email), eq(users.username, email)),
        ne(users.id, input.userId)
      )).limit(1);
      if (duplicate) throw new AuthError("An account with this email already exists.", 409);
    }
    if (input.name || email || input.status || input.emailNotificationsEnabled !== undefined) {
      await tx.update(users).set({
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(email ? { username: email, email } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.emailNotificationsEnabled !== undefined ? { emailNotificationsEnabled: input.emailNotificationsEnabled } : {}),
        updatedAt: new Date()
      }).where(eq(users.id, input.userId));
    }
    if (input.role) {
      await tx.update(memberships).set({
        role: input.role,
        updatedAt: new Date()
      }).where(and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.userId, input.userId)
      ));
    }
  });
  if (input.status === "disabled" || input.role) await revokeUserSessions(input.userId);
  await recordAuthEvent({
    userId: input.userId,
    event: "account_updated",
    success: true,
    metadata: { actorId: input.actorId, role: input.role, status: input.status },
    organizationId: input.organizationId
  });
  return { updated: true };
}

export async function resetOrganizationUserPassword(input: {
  userId: string;
  actorId: string;
  organizationId: string;
  password: string;
}) {
  const database = requireDatabase();
  if (input.userId === MTI_OPERATOR_ID) throw new AuthError("Admin credentials are managed in Railway.", 400);
  const now = new Date();
  const passwordHash = await hashPassword(input.password);
  const account = await database.transaction(async (tx) => {
    const [membership] = await tx.select({ id: memberships.id }).from(memberships).where(and(
      eq(memberships.organizationId, input.organizationId),
      eq(memberships.userId, input.userId)
    )).limit(1);
    if (!membership) throw new AuthError("User not found.", 404);
    const [updated] = await tx.update(users).set({
      passwordHash, forcePasswordChange: false, temporaryPasswordExpiresAt: null,
      passwordChangedAt: now, updatedAt: now
    }).where(eq(users.id, input.userId)).returning({ id: users.id, username: users.username });
    return updated;
  });
  if (!account) throw new AuthError("User not found.", 404);
  await revokeUserSessions(input.userId);
  await recordAuthEvent({
    userId: input.userId,
    username: account.username,
    event: "password_reset",
    success: true,
    metadata: { actorId: input.actorId },
    organizationId: input.organizationId
  });
  return { updated: true };
}

export function normalizeEmailAddress(value: string) {
  return value.trim().toLowerCase();
}
