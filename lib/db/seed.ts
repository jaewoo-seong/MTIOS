import { agentDefinitions, memberships, organizations, userPreferences, users } from "@/lib/db/schema";
import { requireDatabase } from "@/lib/db/client";
import { MTI_OPERATOR_ID, MTI_ORGANIZATION_ID } from "@/lib/repository";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";

const executiveToolScopes = [
  "project:read", "knowledge:read", "plan:create", "task:delegate",
  "workspace:read", "client_data:read", "client_data:propose",
  "report:create", "document:read", "storage:write", "research:read",
  "research:query"
];
const workerToolScopes = [
  "project:read", "knowledge:read", "output:propose", "workspace:read",
  "client_data:read", "report:create", "document:read", "storage:write",
  "research:read", "research:query"
];

export async function seedDefaultWorkspace() {
  const database = requireDatabase();
  await database.insert(organizations).values({
    id: MTI_ORGANIZATION_ID,
    name: "MTI Korea",
    slug: "mti-korea"
  }).onConflictDoNothing();
  await database.insert(users).values({
    id: MTI_OPERATOR_ID,
    name: "Default operator",
    email: "operator@mti.local"
  }).onConflictDoNothing();
  await database.insert(memberships).values({
    organizationId: MTI_ORGANIZATION_ID,
    userId: MTI_OPERATOR_ID,
    role: "admin"
  }).onConflictDoNothing();
  await database.update(memberships).set({
    role: "admin",
    updatedAt: new Date()
  }).where(and(
    eq(memberships.organizationId, MTI_ORGANIZATION_ID),
    eq(memberships.userId, MTI_OPERATOR_ID)
  ));
  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? process.env.APP_BASIC_AUTH_PASSWORD;
  const [operator] = await database.select({
    passwordHash: users.passwordHash
  }).from(users).where(eq(users.id, MTI_OPERATOR_ID)).limit(1);
  if (!operator?.passwordHash && bootstrapPassword) {
    await database.update(users).set({
      passwordHash: await hashPassword(bootstrapPassword),
      forcePasswordChange: true,
      temporaryPasswordExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      updatedAt: new Date()
    }).where(eq(users.id, MTI_OPERATOR_ID));
  }
  await database.insert(userPreferences).values({
    organizationId: MTI_ORGANIZATION_ID,
    userId: MTI_OPERATOR_ID
  }).onConflictDoNothing();
  const [existingAgent] = await database.select({ id: agentDefinitions.id })
    .from(agentDefinitions)
    .limit(1);
  if (!existingAgent) {
    await database.insert(agentDefinitions).values([
      {
        organizationId: MTI_ORGANIZATION_ID,
        name: "Executive Agent",
        role: "executive",
        modelRoute: "executive_reasoning",
        capabilities: ["research", "marketing", "brainstorming", "content", "data_enrichment", "document", "communication", "analysis", "operations", "custom"],
        toolScopes: executiveToolScopes,
        reviewRequired: true
      },
      {
        organizationId: MTI_ORGANIZATION_ID,
        name: "General Worker",
        role: "worker",
        modelRoute: "worker_fast",
        capabilities: ["research", "marketing", "brainstorming", "content", "data_enrichment", "document", "analysis", "operations"],
        toolScopes: workerToolScopes,
        reviewRequired: false
      }
    ]);
  }
  await database.update(agentDefinitions).set({
    toolScopes: executiveToolScopes,
    updatedAt: new Date()
  }).where(and(
    eq(agentDefinitions.organizationId, MTI_ORGANIZATION_ID),
    eq(agentDefinitions.role, "executive")
  ));
  await database.update(agentDefinitions).set({
    toolScopes: workerToolScopes,
    updatedAt: new Date()
  }).where(and(
    eq(agentDefinitions.organizationId, MTI_ORGANIZATION_ID),
    eq(agentDefinitions.role, "worker")
  ));
}
