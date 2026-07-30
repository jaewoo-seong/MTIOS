import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  mcpDiscoveries,
  mcpInvocations,
  mcpPrompts,
  mcpResources,
  mcpServers,
  mcpToolGrants,
  mcpTools,
  reviews
} from "@/lib/db/schema";
import {
  getInternalTool,
  internalToolCatalog,
  type McpApprovalRequirement,
  type McpRiskLevel
} from "@/lib/mcp/catalog";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export type McpScope = {
  role: "executive" | "worker" | "reviewer";
  projectId?: string | null;
  runId?: string | null;
  workerRunId?: string | null;
  permissions: string[];
  maxCostCents?: number | null;
};

type RegisteredTool = {
  id: string;
  serverId: string;
  name: string;
  description: string;
  group: string;
  riskLevel: McpRiskLevel;
  approvalRequirement: McpApprovalRequirement;
  permissions: string[];
  budgetCents: number | null;
  inputSchema: Record<string, unknown>;
  active: boolean;
};

type MemoryPlatform = {
  server: { id: string; name: string; endpoint: string } | null;
  tools: RegisteredTool[];
  invocations: Array<Record<string, unknown>>;
  discoveries: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  grants: Array<Record<string, unknown>>;
};
const globalMcp = globalThis as typeof globalThis & { __mtiMcpPlatform?: MemoryPlatform };
const memory = globalMcp.__mtiMcpPlatform ??= {
  server: null, tools: [], invocations: [], discoveries: [], reviews: [], grants: []
};

export async function registerInternalMcpServer() {
  const endpoint = process.env.MCP_SERVICE_URL ?? "http://localhost:3002/mcp";
  if (!db) {
    const server = memory.server ??= {
      id: crypto.randomUUID(),
      name: "mti-internal-tools",
      endpoint
    };
    server.endpoint = endpoint;
    memory.tools = internalToolCatalog.map((tool) => {
      const existing = memory.tools.find((item) => item.name === tool.name);
      return {
        id: existing?.id ?? crypto.randomUUID(),
        serverId: server.id,
        name: tool.name,
        description: tool.description,
        group: tool.group,
        riskLevel: tool.riskLevel,
        approvalRequirement: tool.approvalRequirement,
        permissions: [...tool.permissions],
        budgetCents: tool.budgetCents,
        inputSchema: {},
        active: true
      };
    });
    return { server, tools: memory.tools };
  }

  return db.transaction(async (tx) => {
    const [server] = await tx.insert(mcpServers).values({
      organizationId: MTI_ORGANIZATION_ID,
      name: "mti-internal-tools",
      endpoint,
      authSecretRef: "MCP_SERVICE_SECRET",
      capabilities: { tools: true, resources: true, prompts: true }
    }).onConflictDoUpdate({
      target: [mcpServers.organizationId, mcpServers.name],
      set: { endpoint, status: "active", updatedAt: new Date() }
    }).returning();
    for (const tool of internalToolCatalog) {
      await tx.insert(mcpTools).values({
        organizationId: MTI_ORGANIZATION_ID,
        serverId: server.id,
        name: tool.name,
        description: tool.description,
        inputSchema: {},
        group: tool.group,
        riskLevel: tool.riskLevel,
        approvalRequirement: tool.approvalRequirement,
        budgetCents: tool.budgetCents,
        permissions: [...tool.permissions]
      }).onConflictDoUpdate({
        target: [mcpTools.serverId, mcpTools.name],
        set: {
          description: tool.description,
          group: tool.group,
          riskLevel: tool.riskLevel,
          approvalRequirement: tool.approvalRequirement,
          budgetCents: tool.budgetCents,
          permissions: [...tool.permissions],
          active: true,
          discoveredAt: new Date(),
          updatedAt: new Date()
        }
      });
    }
    return {
      server,
      tools: await tx.select().from(mcpTools).where(eq(mcpTools.serverId, server.id))
    };
  });
}

export async function discoverMcpServer() {
  const registered = await registerInternalMcpServer();
  const started = Date.now();
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;
  try {
    client = new Client({ name: "mti-business-os", version: "1.0.0" });
    transport = new StreamableHTTPClientTransport(new URL(registered.server.endpoint), {
      requestInit: {
        headers: { authorization: `Bearer ${process.env.MCP_SERVICE_SECRET ?? ""}` }
      }
    });
    await client.connect(transport);
    const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listPrompts()
    ]);
    const payload = {
      tools: toolsResult.tools,
      resources: resourcesResult.resources,
      prompts: promptsResult.prompts
    };
    await persistDiscovery(registered.server.id, "completed", payload, Date.now() - started);
    return payload;
  } catch (error) {
    await persistDiscovery(
      registered.server.id,
      "failed",
      {},
      Date.now() - started,
      error instanceof Error ? error.message : "MCP discovery failed."
    );
    throw error;
  } finally {
    await transport?.close();
    await client?.close();
  }
}

async function persistDiscovery(
  serverId: string,
  status: string,
  payload: {
    tools?: Array<Record<string, unknown>>;
    resources?: Array<Record<string, unknown>>;
    prompts?: Array<Record<string, unknown>>;
  },
  durationMs: number,
  error?: string
) {
  const record = {
    id: crypto.randomUUID(),
    serverId,
    status,
    toolsCount: payload.tools?.length ?? 0,
    resourcesCount: payload.resources?.length ?? 0,
    promptsCount: payload.prompts?.length ?? 0,
    payload,
    durationMs,
    error: error ?? null
  };
  if (!db) {
    memory.discoveries.push(record);
    return record;
  }
  await db.transaction(async (tx) => {
    await tx.insert(mcpDiscoveries).values({
      organizationId: MTI_ORGANIZATION_ID,
      serverId,
      status,
      toolsCount: record.toolsCount,
      resourcesCount: record.resourcesCount,
      promptsCount: record.promptsCount,
      payload,
      durationMs,
      error
    });
    for (const resource of payload.resources ?? []) {
      if (typeof resource.uri !== "string" || typeof resource.name !== "string") continue;
      await tx.insert(mcpResources).values({
        organizationId: MTI_ORGANIZATION_ID,
        serverId,
        uri: resource.uri,
        name: resource.name,
        description: typeof resource.description === "string" ? resource.description : "",
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : null
      }).onConflictDoUpdate({
        target: [mcpResources.serverId, mcpResources.uri],
        set: { active: true, updatedAt: new Date() }
      });
    }
    for (const prompt of payload.prompts ?? []) {
      if (typeof prompt.name !== "string") continue;
      await tx.insert(mcpPrompts).values({
        organizationId: MTI_ORGANIZATION_ID,
        serverId,
        name: prompt.name,
        description: typeof prompt.description === "string" ? prompt.description : "",
        arguments: Array.isArray(prompt.arguments)
          ? prompt.arguments as Array<Record<string, unknown>>
          : []
      }).onConflictDoUpdate({
        target: [mcpPrompts.serverId, mcpPrompts.name],
        set: { active: true, updatedAt: new Date() }
      });
    }
    await tx.update(mcpServers).set({
      healthStatus: status === "completed" ? "ok" : "error",
      lastHealthCheckAt: new Date(),
      updatedAt: new Date()
    }).where(eq(mcpServers.id, serverId));
  });
  return record;
}

export async function listAllowedMcpTools(scope: McpScope) {
  const { tools } = await registerInternalMcpServer();
  const candidates = tools as RegisteredTool[];
  if (!db) {
    return candidates.filter((tool) => {
      const matching = memory.grants.filter((grant) =>
        grant.toolId === tool.id && grant.role === scope.role
      );
      const exact = scope.projectId
        ? matching.find((grant) => grant.projectId === scope.projectId)
        : undefined;
      if (exact) return exact.allowed === true && isDefaultRoleAllowed(tool, scope);
      const global = matching.find((grant) => grant.projectId === null);
      if (global) return global.allowed === true && isDefaultRoleAllowed(tool, scope);
      return isDefaultRoleAllowed(tool, scope);
    });
  }
  const grants = await db.select().from(mcpToolGrants).where(and(
    eq(mcpToolGrants.organizationId, MTI_ORGANIZATION_ID),
    eq(mcpToolGrants.role, scope.role),
    scope.projectId
      ? or(eq(mcpToolGrants.projectId, scope.projectId), isNull(mcpToolGrants.projectId))
      : isNull(mcpToolGrants.projectId)
  ));
  return candidates.filter((tool) => {
    const matching = grants.filter((grant) => grant.toolId === tool.id);
    const exact = scope.projectId
      ? matching.find((grant) => grant.projectId === scope.projectId)
      : undefined;
    if (exact) return exact.allowed;
    const global = matching.find((grant) => grant.projectId === null);
    if (global) return global.allowed;
    return isDefaultRoleAllowed(tool, scope);
  });
}

function isDefaultRoleAllowed(tool: RegisteredTool, scope: McpScope) {
  if (!tool.active) return false;
  if (!tool.permissions.every((permission) => scope.permissions.includes(permission))) return false;
  if (scope.role === "reviewer" && tool.riskLevel !== "low") return false;
  if (scope.role === "worker" && tool.riskLevel === "critical") return false;
  return true;
}

/**
 * A caller may only tighten an agent's configured spending ceiling for a
 * single call, never raise it — otherwise a client-supplied `maxCostCents`
 * widens the agent's real budget instead of scoping one invocation under it.
 */
export function clampCostCeiling(requested: number | null | undefined, agentBudgetCents: number | null) {
  if (agentBudgetCents === null) return requested ?? null;
  if (requested === null || requested === undefined) return agentBudgetCents;
  return Math.min(requested, agentBudgetCents);
}

export async function invokeMcpTool(input: {
  toolName: string;
  arguments: Record<string, unknown>;
  scope: McpScope;
  approvedReviewId?: string | null;
  call?: (toolName: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const allowed = await listAllowedMcpTools(input.scope);
  const tool = allowed.find((item) => item.name === input.toolName);
  if (!tool) throw new Error("Tool is not allowed for this role, project, or permission scope.");
  if (input.scope.maxCostCents !== null && input.scope.maxCostCents !== undefined &&
      (tool.budgetCents ?? 0) > input.scope.maxCostCents) {
    throw new Error("Tool budget exceeds scoped execution limit.");
  }
  await enforceGrantLimits(tool, input.scope);

  const reviewId = await resolveApproval(tool, input);
  if (tool.approvalRequirement === "always" && !reviewId.approved) {
    return {
      status: "approval_required" as const,
      reviewId: reviewId.id,
      tool: tool.name
    };
  }

  const invocationId = crypto.randomUUID();
  const started = Date.now();
  await createInvocation(invocationId, tool, input, reviewId.id, "executing");
  try {
    const output = input.call
      ? await input.call(tool.name, input.arguments)
      : await callRemoteTool(tool.name, input.arguments);
    await finishInvocation(invocationId, "completed", Date.now() - started, output);
    return { status: "completed" as const, invocationId, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP invocation failed.";
    await finishInvocation(invocationId, "failed", Date.now() - started, null, message);
    throw error;
  }
}

async function resolveApproval(
  tool: RegisteredTool,
  input: {
    arguments: Record<string, unknown>;
    scope: McpScope;
    approvedReviewId?: string | null;
  }
) {
  if (tool.approvalRequirement !== "always") return { id: null, approved: true };
  if (input.approvedReviewId) {
    if (!db) {
      const review = memory.reviews.find((item) =>
        item.id === input.approvedReviewId && item.status === "approved"
      );
      return { id: input.approvedReviewId, approved: Boolean(review) };
    }
    const [review] = await db.select({ id: reviews.id }).from(reviews).where(and(
      eq(reviews.id, input.approvedReviewId),
      eq(reviews.organizationId, MTI_ORGANIZATION_ID),
      eq(reviews.status, "approved")
    )).limit(1);
    return { id: input.approvedReviewId, approved: Boolean(review) };
  }
  const reviewId = crypto.randomUUID();
  const subjectId = crypto.randomUUID();
  if (!db) {
    memory.reviews.push({
      id: reviewId,
      subjectId,
      status: "pending",
      toolName: tool.name,
      input: input.arguments
    });
  } else {
    await db.insert(reviews).values({
      id: reviewId,
      organizationId: MTI_ORGANIZATION_ID,
      projectId: input.scope.projectId ?? null,
      subjectType: "mcp_tool_invocation",
      subjectId,
      reason: `${tool.name} requires explicit approval.`
    });
  }
  await createInvocation(subjectId, tool, input, reviewId, "approval_required");
  return { id: reviewId, approved: false };
}

async function callRemoteTool(toolName: string, args: Record<string, unknown>) {
  const secret = process.env.MCP_SERVICE_SECRET;
  const endpoint = process.env.MCP_SERVICE_URL;
  if (!secret || !endpoint) throw new Error("MCP service connection is not configured.");
  const client = new Client({ name: "mti-business-os", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${secret}` } }
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    if (result.structuredContent && typeof result.structuredContent === "object") {
      return result.structuredContent as Record<string, unknown>;
    }
    return { content: result.content };
  } finally {
    await transport.close();
    await client.close();
  }
}

async function createInvocation(
  id: string,
  tool: RegisteredTool,
  input: { arguments: Record<string, unknown>; scope: McpScope },
  reviewId: string | null,
  status: string
) {
  const record = {
    id,
    serverId: tool.serverId,
    toolId: tool.id,
    projectId: input.scope.projectId ?? null,
    runId: input.scope.runId ?? null,
    workerRunId: input.scope.workerRunId ?? null,
    reviewId,
    role: input.scope.role,
    input: input.arguments,
    status
  };
  if (!db) {
    memory.invocations.push(record);
    return;
  }
  await db.insert(mcpInvocations).values({
    organizationId: MTI_ORGANIZATION_ID,
    ...record
  });
}

async function finishInvocation(
  id: string,
  status: string,
  durationMs: number,
  output: Record<string, unknown> | null,
  error?: string
) {
  if (!db) {
    const row = memory.invocations.find((item) => item.id === id);
    if (row) Object.assign(row, { status, durationMs, output, error: error ?? null });
    return;
  }
  await db.update(mcpInvocations).set({
    status,
    durationMs,
    output,
    error,
    completedAt: new Date(),
    updatedAt: new Date()
  }).where(and(
    eq(mcpInvocations.id, id),
    eq(mcpInvocations.organizationId, MTI_ORGANIZATION_ID)
  ));
}

export async function grantMcpTool(input: {
  toolName: string;
  role: McpScope["role"];
  projectId?: string | null;
  allowed: boolean;
  maxCalls?: number | null;
  maxCostCents?: number | null;
}) {
  const { tools } = await registerInternalMcpServer();
  const tool = (tools as RegisteredTool[]).find((item) => item.name === input.toolName);
  if (!tool) throw new Error("MCP tool not found.");
  if (!db) {
    const existing = memory.grants.find((item) =>
      item.toolId === tool.id &&
      item.role === input.role &&
      (item.projectId ?? null) === (input.projectId ?? null)
    );
    const grant = {
      ...(existing ?? { id: crypto.randomUUID() }),
      ...input,
      projectId: input.projectId ?? null,
      toolId: tool.id
    };
    if (existing) Object.assign(existing, grant);
    else memory.grants.push(grant);
    return grant;
  }
  const [grant] = await db.insert(mcpToolGrants).values({
    organizationId: MTI_ORGANIZATION_ID,
    toolId: tool.id,
    role: input.role,
    projectId: input.projectId ?? null,
    allowed: input.allowed,
    maxCalls: input.maxCalls ?? null,
    maxCostCents: input.maxCostCents ?? null
  }).onConflictDoUpdate({
    target: [mcpToolGrants.toolId, mcpToolGrants.role, mcpToolGrants.projectId],
    set: {
      allowed: input.allowed,
      maxCalls: input.maxCalls ?? null,
      maxCostCents: input.maxCostCents ?? null,
      updatedAt: new Date()
    }
  }).returning();
  return grant;
}

async function enforceGrantLimits(tool: RegisteredTool, scope: McpScope) {
  if (!db) {
    const grants = memory.grants.filter((item) =>
      item.toolId === tool.id && item.role === scope.role
    );
    const grant = (scope.projectId
      ? grants.find((item) => item.projectId === scope.projectId)
      : null) ?? grants.find((item) => item.projectId === null);
    if (!grant) return;
    const calls = memory.invocations.filter((item) =>
      item.toolId === tool.id &&
      item.role === scope.role &&
      (item.projectId ?? null) === (scope.projectId ?? null) &&
      item.status !== "approval_required"
    ).length;
    if (typeof grant.maxCalls === "number" && calls >= grant.maxCalls) {
      throw new Error("Tool call limit reached for scoped grant.");
    }
    if (typeof grant.maxCostCents === "number" &&
        (tool.budgetCents ?? 0) > grant.maxCostCents) {
      throw new Error("Tool cost exceeds scoped grant.");
    }
    return;
  }
  const grants = await db.select().from(mcpToolGrants).where(and(
    eq(mcpToolGrants.organizationId, MTI_ORGANIZATION_ID),
    eq(mcpToolGrants.toolId, tool.id),
    eq(mcpToolGrants.role, scope.role),
    scope.projectId
      ? or(eq(mcpToolGrants.projectId, scope.projectId), isNull(mcpToolGrants.projectId))
      : isNull(mcpToolGrants.projectId)
  ));
  const grant = (scope.projectId
    ? grants.find((item) => item.projectId === scope.projectId)
    : null) ?? grants.find((item) => item.projectId === null);
  if (!grant) return;
  if (grant.maxCostCents !== null && (tool.budgetCents ?? 0) > grant.maxCostCents) {
    throw new Error("Tool cost exceeds scoped grant.");
  }
  if (grant.maxCalls !== null) {
    const calls = await db.select({ id: mcpInvocations.id }).from(mcpInvocations).where(and(
      eq(mcpInvocations.organizationId, MTI_ORGANIZATION_ID),
      eq(mcpInvocations.toolId, tool.id),
      eq(mcpInvocations.role, scope.role),
      scope.projectId
        ? eq(mcpInvocations.projectId, scope.projectId)
        : isNull(mcpInvocations.projectId)
    ));
    if (calls.filter((item) => item.id).length >= grant.maxCalls) {
      throw new Error("Tool call limit reached for scoped grant.");
    }
  }
}

export function getMcpTestState() {
  return memory;
}
