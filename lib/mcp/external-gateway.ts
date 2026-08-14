import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gte, lte, sql, sum } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDatabase } from "@/lib/db/client";
import { mcpExternalInvocations, modelCalls } from "@/lib/db/schema";
import { externalMcpToolCatalog } from "@/lib/mcp/external-contracts";
import {
  authenticateExternalMcpRequest,
  ExternalMcpAuthError,
  requestHash,
  type ExternalMcpPrincipal
} from "@/lib/mcp/external-credentials";
import { executeExternalReadTool, ExternalMcpAccessError } from "@/lib/mcp/external-read";
import { executeExternalWriteTool } from "@/lib/mcp/external-write";
import { logger, reportError } from "@/lib/observability/logger";
import { consumeRateLimit, rateLimitHeaders, requestSubject } from "@/lib/rate-limit";

const readToolNames = new Set([
  "list_research_projects", "get_research_project", "get_project_briefing",
  "search_business_os", "get_company_research", "get_document"
]);
const implementedToolNames = new Set([
  ...readToolNames,
  "draft_research_project",
  "activate_research_project",
  "create_cross_project_report"
]);

export function visibleExternalTools(principal: ExternalMcpPrincipal) {
  return externalMcpToolCatalog.filter((tool) =>
    implementedToolNames.has(tool.name) && tool.scopes.every((scope) => principal.scopes.includes(scope))
  );
}

export function visibleExternalReadTools(principal: ExternalMcpPrincipal) {
  return visibleExternalTools(principal).filter((tool) => !tool.write);
}

export async function authorizeExternalGatewayRequest(request: Request) {
  const configured = process.env.EXTERNAL_MCP_GATEWAY_SECRET;
  const supplied = request.headers.get("x-mti-external-gateway-secret");
  if (!configured || configured.length < 32) return { error: NextResponse.json({ error: "service_unavailable" }, { status: 503 }) };
  if (!safeEqual(configured, supplied ?? "")) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const trustedClientIp = request.headers.get("x-mti-client-ip")?.trim();
  const ipLimit = await consumeRateLimit(`external-mcp-ip:${trustedClientIp || requestSubject(request)}`, "standard");
  if (!ipLimit.allowed) return { error: NextResponse.json({ error: "rate_limited" }, { status: 429, headers: rateLimitHeaders(ipLimit) }) };
  try {
    const principal = await authenticateExternalMcpRequest(request.headers.get("authorization"));
    const credentialLimit = await consumeRateLimit(`external-mcp-credential:${principal.credentialId}`, "standard");
    if (!credentialLimit.allowed) return { error: NextResponse.json({ error: "rate_limited" }, { status: 429, headers: rateLimitHeaders(credentialLimit) }) };
    return { principal, headers: rateLimitHeaders(credentialLimit) };
  } catch (error) {
    if (!(error instanceof ExternalMcpAuthError)) reportError("external_mcp.authentication_failed", error);
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
}

export async function invokeExternalTool(principal: ExternalMcpPrincipal, toolName: string, rawInput: unknown) {
  const tool = visibleExternalTools(principal).find((candidate) => candidate.name === toolName);
  if (!tool) throw new ExternalMcpAccessError("forbidden", "Tool is unavailable for this credential.");
  let input: Record<string, unknown>;
  try {
    input = tool.inputSchema.parse(rawInput) as Record<string, unknown>;
  } catch (error) {
    const db = requireDatabase();
    const fields = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? Object.keys(rawInput as Record<string, unknown>).sort()
      : [];
    await db.insert(mcpExternalInvocations).values({
      organizationId: principal.organizationId,
      credentialId: principal.credentialId,
      toolName,
      requestHash: requestHash(rawInput),
      requestSummary: { fields },
      status: "failed",
      errorCode: "invalid_arguments",
      durationMs: 0,
      completedAt: new Date()
    });
    throw error;
  }
  if (tool.write) {
    const expensiveLimit = await consumeRateLimit(`external-mcp-write:${principal.credentialId}`, "expensive");
    if (!expensiveLimit.allowed) throw new ExternalMcpAccessError("rate_limited");
  }
  const db = requireDatabase();
  const startedAt = new Date();
  const invocation = await beginInvocation(principal, toolName, input, tool.write, startedAt);
  if (invocation.replay) return tool.outputSchema.parse(invocation.replay);
  try {
    const rawOutput = tool.write
      ? await executeExternalWriteTool(principal, invocation.id, toolName as Parameters<typeof executeExternalWriteTool>[2], input)
      : await executeExternalReadTool(principal, toolName as Parameters<typeof executeExternalReadTool>[1], input);
    const output = tool.outputSchema.parse(rawOutput);
    const completedAt = new Date();
    const resultSummary = summarizeResult(output);
    const modelCostMicros = await invocationModelCost(
      principal,
      typeof (output as Record<string, unknown>).projectId === "string"
        ? String((output as Record<string, unknown>).projectId)
        : typeof input.projectId === "string" ? input.projectId : null,
      startedAt,
      completedAt
    );
    await db.update(mcpExternalInvocations).set({
      status: "completed", durationMs: completedAt.getTime() - startedAt.getTime(), completedAt,
      resultSummary, outputTruncated: resultSummary.truncated === true, modelCostMicros,
      response: tool.write ? output as Record<string, unknown> : null, updatedAt: completedAt
    }).where(and(eq(mcpExternalInvocations.id, invocation.id), eq(mcpExternalInvocations.organizationId, principal.organizationId)));
    return output;
  } catch (error) {
    const code = error instanceof ExternalMcpAccessError ? error.code : "internal_error";
    await db.update(mcpExternalInvocations).set({
      status: "failed", durationMs: Date.now() - startedAt.getTime(), completedAt: new Date(), errorCode: code, updatedAt: new Date()
    }).where(and(eq(mcpExternalInvocations.id, invocation.id), eq(mcpExternalInvocations.organizationId, principal.organizationId)));
    if (!(error instanceof ExternalMcpAccessError)) reportError("external_mcp.invocation_failed", error, { credentialId: principal.credentialId, toolName });
    throw error;
  }
}

/** Backward-compatible name for the Phase 2 internal route import. */
export const invokeExternalReadTool = invokeExternalTool;

export function externalMcpErrorResponse(error: unknown) {
  if (error instanceof ExternalMcpAccessError) {
    const status = error.code === "forbidden" ? 403
      : error.code === "not_found" ? 404
      : error.code === "idempotency_conflict" || error.code === "in_progress" ? 409
      : error.code === "rate_limited" ? 429
      : 400;
    return NextResponse.json({ error: error.code }, { status });
  }
  if (error && typeof error === "object" && "issues" in error) return NextResponse.json({ error: "invalid_arguments" }, { status: 400 });
  logger.error("external_mcp.opaque_failure");
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

async function beginInvocation(
  principal: ExternalMcpPrincipal,
  toolName: string,
  input: Record<string, unknown>,
  write: boolean,
  startedAt: Date
): Promise<{ id: string; replay: Record<string, unknown> | null }> {
  const db = requireDatabase();
  const hash = requestHash(input);
  const values = {
    organizationId: principal.organizationId,
    credentialId: principal.credentialId,
    toolName,
    projectId: projectIdFrom(input),
    idempotencyKey: write ? String(input.idempotencyKey) : null,
    requestHash: hash,
    requestSummary: { fields: Object.keys(input).sort(), projectCount: Array.isArray(input.projectIds) ? input.projectIds.length : undefined },
    status: "running",
    startedAt
  };
  if (!write) {
    const [created] = await db.insert(mcpExternalInvocations).values(values).returning({ id: mcpExternalInvocations.id });
    return { id: created.id, replay: null };
  }
  return db.transaction(async (tx) => {
    const lockKey = `${principal.credentialId}:${toolName}:${String(input.idempotencyKey)}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const [existing] = await tx.select().from(mcpExternalInvocations).where(and(
      eq(mcpExternalInvocations.credentialId, principal.credentialId),
      eq(mcpExternalInvocations.toolName, toolName),
      eq(mcpExternalInvocations.idempotencyKey, String(input.idempotencyKey))
    )).limit(1);
    if (existing) {
      if (existing.requestHash !== hash) throw new ExternalMcpAccessError("idempotency_conflict");
      if (existing.status === "completed" && existing.response) return { id: existing.id, replay: existing.response };
      if (existing.status === "running" && existing.startedAt.getTime() > Date.now() - 15 * 60 * 1000) {
        throw new ExternalMcpAccessError("in_progress");
      }
      await tx.update(mcpExternalInvocations).set({
        status: "running", errorCode: null, response: null, completedAt: null,
        durationMs: 0, startedAt, updatedAt: new Date()
      }).where(eq(mcpExternalInvocations.id, existing.id));
      return { id: existing.id, replay: null };
    }
    const [created] = await tx.insert(mcpExternalInvocations).values(values).returning({ id: mcpExternalInvocations.id });
    return { id: created.id, replay: null };
  });
}

function projectIdFrom(input: Record<string, unknown>) {
  return typeof input.projectId === "string" ? input.projectId : null;
}

function summarizeResult(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== "object") return { type: typeof output };
  const value = output as Record<string, unknown>;
  const array = Object.values(value).find(Array.isArray);
  return {
    fields: Object.keys(value).sort(),
    itemCount: Array.isArray(array) ? array.length : undefined,
    truncated: containsTruncation(value)
  };
}

function containsTruncation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (!Array.isArray(value) && (value as Record<string, unknown>).truncated === true) return true;
  return Object.values(value).some(containsTruncation);
}

async function invocationModelCost(
  principal: ExternalMcpPrincipal,
  projectId: string | null,
  startedAt: Date,
  completedAt: Date
) {
  if (!projectId) return 0;
  const db = requireDatabase();
  const [row] = await db.select({ value: sum(modelCalls.costMicros) }).from(modelCalls).where(and(
    eq(modelCalls.projectId, projectId),
    eq(modelCalls.userId, principal.createdByUserId),
    gte(modelCalls.createdAt, startedAt),
    lte(modelCalls.createdAt, completedAt)
  ));
  return Number(row?.value ?? 0);
}

function safeEqual(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
