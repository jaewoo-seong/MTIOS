import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { rotateExternalMcpCredential } from "@/lib/mcp/external-credentials";
import { logger } from "@/lib/observability/logger";

export const POST = guard<{ credentialId: string }>(async (_request, { session, params }) => {
  const result = await rotateExternalMcpCredential(params.credentialId, session.userId, session.organizationId);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logger.info("admin.mcp_credential_rotated", {
    actorId: session.userId,
    previousCredentialId: params.credentialId,
    credentialId: result.credential.id
  });
  return NextResponse.json({ data: result }, { status: 201 });
}, { admin: true, rateLimit: "auth" });
