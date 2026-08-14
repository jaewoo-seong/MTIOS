import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { revokeExternalMcpCredential } from "@/lib/mcp/external-credentials";
import { logger } from "@/lib/observability/logger";

export const DELETE = guard<{ credentialId: string }>(async (_request, { session, params }) => {
  const credential = await revokeExternalMcpCredential(params.credentialId, session.organizationId);
  if (!credential) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logger.info("admin.mcp_credential_revoked", { actorId: session.userId, credentialId: params.credentialId });
  return NextResponse.json({ data: credential });
}, { admin: true, rateLimit: "auth" });
