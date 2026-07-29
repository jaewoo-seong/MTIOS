import { agentDefinitions, memberships, organizations, users } from "@/lib/db/schema";
import { requireDatabase } from "@/lib/db/client";
import { MTI_OPERATOR_ID, MTI_ORGANIZATION_ID } from "@/lib/repository";

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
    role: "owner"
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
        toolScopes: ["project:read", "knowledge:read", "plan:create", "task:delegate"],
        reviewRequired: true
      },
      {
        organizationId: MTI_ORGANIZATION_ID,
        name: "General Worker",
        role: "worker",
        modelRoute: "worker_fast",
        capabilities: ["research", "marketing", "brainstorming", "content", "data_enrichment", "document", "analysis", "operations"],
        toolScopes: ["project:read", "knowledge:read", "output:propose"],
        reviewRequired: false
      }
    ]);
  }
}
