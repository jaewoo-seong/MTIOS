import { and, desc, eq } from "drizzle-orm";
import {
  authenticationEvents,
  memberships,
  userPreferences,
  users
} from "@/lib/db/schema";
import {
  hashPassword,
  recordAuthEvent,
  revokeUserSessions
} from "@/lib/auth";
import { requireDatabase } from "@/lib/db/client";
import { MTI_OPERATOR_ID, MTI_ORGANIZATION_ID } from "@/lib/repository";

export async function listOrganizationUsers() {
  const database = requireDatabase();
  const rows = await database.select({
    id: users.id,
    name: users.name,
    username: users.username,
    status: users.status,
    failedLoginAttempts: users.failedLoginAttempts,
    lockedUntil: users.lockedUntil,
    lastLoginAt: users.lastLoginAt,
    passwordChangedAt: users.passwordChangedAt,
    role: memberships.role,
    createdAt: users.createdAt
  }).from(users).innerJoin(memberships, and(
    eq(memberships.userId, users.id),
    eq(memberships.organizationId, MTI_ORGANIZATION_ID)
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
    .where(eq(authenticationEvents.organizationId, MTI_ORGANIZATION_ID))
    .orderBy(desc(authenticationEvents.createdAt))
    .limit(100);
  return { users: rows, history };
}

export async function createOrganizationUser(input: {
  name: string;
  username: string;
  password: string;
  role: "admin" | "member";
  actorId: string;
}) {
  const database = requireDatabase();
  const [created] = await database.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({
      name: input.name.trim(),
      username: input.username.trim().toLowerCase(),
      email: null,
      passwordHash: await hashPassword(input.password),
      status: "active",
      forcePasswordChange: false,
      temporaryPasswordExpiresAt: null
    }).returning();
    await tx.insert(memberships).values({
      organizationId: MTI_ORGANIZATION_ID,
      userId: user.id,
      role: input.role
    });
    await tx.insert(userPreferences).values({
      organizationId: MTI_ORGANIZATION_ID,
      userId: user.id
    });
    return [user];
  });
  await recordAuthEvent({
    userId: created.id,
    username: created.username,
    event: "account_created",
    success: true,
    metadata: { actorId: input.actorId, role: input.role }
  });
  return {
    user: {
      id: created.id,
      name: created.name,
      username: created.username,
      role: input.role,
      status: created.status,
      forcePasswordChange: false
    }
  };
}

export async function updateOrganizationUser(input: {
  userId: string;
  actorId: string;
  name?: string;
  username?: string;
  role?: "admin" | "member";
  status?: "active" | "disabled";
}) {
  const database = requireDatabase();
  if (input.userId === MTI_OPERATOR_ID && (input.role === "member" || input.status === "disabled")) {
    throw new Error("Seeded administrator cannot be demoted or disabled.");
  }
  await database.transaction(async (tx) => {
    if (input.name || input.username || input.status) {
      await tx.update(users).set({
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.username ? { username: input.username.trim().toLowerCase() } : {}),
        ...(input.status ? { status: input.status } : {}),
        updatedAt: new Date()
      }).where(eq(users.id, input.userId));
    }
    if (input.role) {
      await tx.update(memberships).set({
        role: input.role,
        updatedAt: new Date()
      }).where(and(
        eq(memberships.organizationId, MTI_ORGANIZATION_ID),
        eq(memberships.userId, input.userId)
      ));
    }
  });
  if (input.status === "disabled" || input.role) await revokeUserSessions(input.userId);
  await recordAuthEvent({
    userId: input.userId,
    event: "account_updated",
    success: true,
    metadata: { actorId: input.actorId, role: input.role, status: input.status }
  });
  return { updated: true };
}

export async function resetOrganizationUserPassword(userId: string, actorId: string, password: string) {
  const database = requireDatabase();
  if (userId === MTI_OPERATOR_ID) throw new Error("Admin credentials are managed in Railway.");
  const [account] = await database.update(users).set({
    passwordHash: await hashPassword(password),
    forcePasswordChange: false,
    temporaryPasswordExpiresAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date()
  }).where(eq(users.id, userId)).returning({ id: users.id, username: users.username });
  if (!account) throw new Error("User not found.");
  await revokeUserSessions(userId);
  await recordAuthEvent({
    userId,
    username: account.username,
    event: "password_reset",
    success: true,
    metadata: { actorId }
  });
  return { updated: true };
}
