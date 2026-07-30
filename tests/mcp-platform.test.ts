import { afterEach, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import {
  clampCostCeiling,
  discoverMcpServer,
  getMcpTestState,
  grantMcpTool,
  invokeMcpTool,
  listAllowedMcpTools,
  registerInternalMcpServer
} from "@/lib/mcp/platform";
import { internalToolCatalog, mcpExtensionGroups } from "@/lib/mcp/catalog";
import { createMcpApp } from "@/services/mcp-tools/server";

const allPermissions = [...new Set(internalToolCatalog.flatMap((tool) => [...tool.permissions]))];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()))
  ));
});

describe("MCP governance", () => {
  it("registers governed initial tool groups and future extension points", async () => {
    const registered = await registerInternalMcpServer();
    expect(registered.tools).toHaveLength(internalToolCatalog.length);
    expect(new Set(internalToolCatalog.map((tool) => tool.group))).toEqual(new Set([
      "search", "project_context", "knowledge", "client_data", "staged_write",
      "reports", "documents", "storage", "research", "communication"
    ]));
    expect(mcpExtensionGroups).toContain("crm");
    expect(mcpExtensionGroups).toContain("manufacturing");
  });

  it("exposes only tools allowed by role permissions", async () => {
    const readOnly = await listAllowedMcpTools({
      role: "worker",
      permissions: ["workspace:read", "project:read"]
    });
    expect(readOnly.map((tool) => tool.name)).toEqual([
      "search_workspace",
      "get_project_context"
    ]);
    expect(readOnly.some((tool) => tool.name === "stage_client_records")).toBe(false);
  });

  it("pauses sensitive tools, links review, then resumes only after approval", async () => {
    let calls = 0;
    const scope = {
      role: "executive" as const,
      projectId: crypto.randomUUID(),
      permissions: allPermissions
    };
    const pending = await invokeMcpTool({
      toolName: "stage_client_records",
      arguments: {
        databaseId: crypto.randomUUID(),
        records: [{ company: "Review only" }]
      },
      scope,
      call: async () => {
        calls += 1;
        return { staged: true };
      }
    });
    expect(pending).toMatchObject({ status: "approval_required" });
    expect(calls).toBe(0);

    const state = getMcpTestState();
    const review = state.reviews.find((item) => item.id === pending.reviewId);
    expect(review).toBeTruthy();
    if (review) review.status = "approved";
    const completed = await invokeMcpTool({
      toolName: "stage_client_records",
      arguments: {
        databaseId: crypto.randomUUID(),
        records: [{ company: "Review only" }]
      },
      scope,
      approvedReviewId: pending.reviewId,
      call: async () => {
        calls += 1;
        return { staged: true, wrote: false };
      }
    });
    expect(completed).toMatchObject({
      status: "completed",
      output: { staged: true, wrote: false }
    });
    expect(calls).toBe(1);
  });

  it("enforces scoped budgets and audits invocation failures", async () => {
    await expect(invokeMcpTool({
      toolName: "search_workspace",
      arguments: { query: "scope" },
      scope: {
        role: "worker",
        permissions: ["workspace:read"],
        maxCostCents: -1
      },
      call: async () => ({})
    })).rejects.toThrow(/budget/i);

    await expect(invokeMcpTool({
      toolName: "search_workspace",
      arguments: { query: "scope" },
      scope: { role: "worker", permissions: ["workspace:read"] },
      call: async () => {
        throw new Error("Tool adapter unavailable.");
      }
    })).rejects.toThrow("Tool adapter unavailable.");
    expect(getMcpTestState().invocations.at(-1)).toMatchObject({
      status: "failed",
      error: "Tool adapter unavailable."
    });
  });

  it("enforces project grant precedence and call limits", async () => {
    const projectId = crypto.randomUUID();
    await grantMcpTool({
      toolName: "search_workspace",
      role: "worker",
      projectId,
      allowed: true,
      maxCalls: 1
    });
    const scope = {
      role: "worker" as const,
      projectId,
      permissions: ["workspace:read"]
    };
    await invokeMcpTool({
      toolName: "search_workspace",
      arguments: { query: "first" },
      scope,
      call: async () => ({ hits: [] })
    });
    await expect(invokeMcpTool({
      toolName: "search_workspace",
      arguments: { query: "second" },
      scope,
      call: async () => ({ hits: [] })
    })).rejects.toThrow(/call limit/i);

    await grantMcpTool({
      toolName: "get_project_context",
      role: "worker",
      allowed: true
    });
    await grantMcpTool({
      toolName: "get_project_context",
      role: "worker",
      projectId,
      allowed: false
    });
    const allowed = await listAllowedMcpTools({
      role: "worker",
      projectId,
      permissions: ["project:read"]
    });
    expect(allowed.some((tool) => tool.name === "get_project_context")).toBe(false);
  });
});

describe("MCP Streamable HTTP service", () => {
  it("requires service authentication and supports real discovery", async () => {
    process.env.MCP_SERVICE_SECRET = `test-${crypto.randomUUID()}`;
    const server = createMcpApp().listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server address unavailable.");
    const base = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${base}/health`)).status).toBe(200);
    const rejectedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(`${base}/health`, {
        headers: { host: "untrusted.example" }
      }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
    expect(rejectedHostStatus).toBe(403);
    expect((await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    })).status).toBe(401);

    process.env.MCP_SERVICE_URL = `${base}/mcp`;
    const discovery = await discoverMcpServer();
    expect(discovery.tools.map((tool) => tool.name)).toContain("search_workspace");
    expect(discovery.resources.map((resource) => resource.uri)).toContain("mti://tool-governance");
    expect(discovery.prompts.map((prompt) => prompt.name)).toContain("scoped-tool-use");
    expect(getMcpTestState().discoveries.at(-1)).toMatchObject({ status: "completed" });
  });
});

describe("clampCostCeiling", () => {
  it("lets a caller tighten the agent's budget", () => {
    expect(clampCostCeiling(500, 2000)).toBe(500);
  });

  it("never lets a caller raise the ceiling above the agent's configured budget", () => {
    // This is the exact bug: a client passing a large maxCostCents used to
    // widen the agent's real spending limit instead of scoping one call
    // under it, letting tools blocked by the agent's normal budget through.
    expect(clampCostCeiling(1_000_000, 2000)).toBe(2000);
  });

  it("falls back to the agent's budget when the caller omits a ceiling", () => {
    expect(clampCostCeiling(null, 2000)).toBe(2000);
    expect(clampCostCeiling(undefined, 2000)).toBe(2000);
  });

  it("leaves an unbudgeted agent's ceiling to the caller", () => {
    expect(clampCostCeiling(500, null)).toBe(500);
    expect(clampCostCeiling(null, null)).toBeNull();
  });
});
