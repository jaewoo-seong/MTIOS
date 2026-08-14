import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { externalMcpScopes } from "@/lib/mcp/external-contracts";
import { createExternalMcpCredential, listExternalMcpCredentials } from "@/lib/mcp/external-credentials";
import { logger } from "@/lib/observability/logger";

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  clientName: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(externalMcpScopes)).min(1).max(externalMcpScopes.length),
  accessMode: z.enum(["selected_projects", "organization"]).default("selected_projects"),
  projectIds: z.array(z.string().uuid()).max(100).default([]),
  expiresAt: z.string().datetime().nullable().default(null)
}).strict();

export const GET = guard(async (_request, { session }) => {
  return NextResponse.json({ data: await listExternalMcpCredentials(session.organizationId) });
}, { admin: true });

export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, createSchema);
  if (parsed.error) return parsed.error;
  try {
    const result = await createExternalMcpCredential({
      ...parsed.data,
      organizationId: session.organizationId,
      createdByUserId: session.userId,
      accessMode: parsed.data.accessMode ?? "selected_projects",
      projectIds: parsed.data.projectIds ?? [],
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
    });
    logger.info("admin.mcp_credential_created", {
      actorId: session.userId,
      credentialId: result.credential.id,
      clientName: parsed.data.clientName,
      accessMode: parsed.data.accessMode
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid_credential" }, { status: 400 });
  }
}, { admin: true, rateLimit: "auth" });
