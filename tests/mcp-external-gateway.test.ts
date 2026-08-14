import { afterEach, describe, expect, it, vi } from "vitest";
import { type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { visibleExternalReadTools, visibleExternalTools } from "@/lib/mcp/external-gateway";
import { canAccessProject } from "@/lib/mcp/external-read";
import type { ExternalMcpPrincipal } from "@/lib/mcp/external-credentials";
import { createExternalMcpApp } from "@/services/mcp-external/server";

const servers: Server[] = [];
const projectId = "10000000-0000-4000-8000-000000000001";

function principal(scopes: ExternalMcpPrincipal["scopes"], mode: ExternalMcpPrincipal["accessMode"] = "selected_projects"): ExternalMcpPrincipal {
  return {
    credentialId: "20000000-0000-4000-8000-000000000001",
    organizationId: "30000000-0000-4000-8000-000000000001",
    createdByUserId: "40000000-0000-4000-8000-000000000001",
    clientName: "Codex",
    scopes,
    accessMode: mode,
    allowedProjectIds: mode === "selected_projects" ? [projectId] : []
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.EXTERNAL_MCP_ALLOWED_ORIGINS;
  delete process.env.EXTERNAL_MCP_INTERNAL_TIMEOUT_MS;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function listen(app: ReturnType<typeof createExternalMcpApp>) {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  return new URL(`http://127.0.0.1:${address.port}`);
}

async function jsonRpc(response: globalThis.Response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (!data) throw new Error("Missing JSON-RPC SSE data");
    return JSON.parse(data) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe("external MCP authorization", () => {
  it("filters discovery to scopes and the Phase 2 read-only set", () => {
    expect(visibleExternalReadTools(principal(["projects:read"])).map((tool) => tool.name)).toEqual([
      "list_research_projects", "get_research_project", "get_project_briefing"
    ]);
    expect(visibleExternalReadTools(principal(["reports:create"]))).toEqual([]);
    expect(visibleExternalReadTools(principal(["documents:read"])).map((tool) => tool.name)).toEqual(["get_document"]);
  });

  it("discovers Phase 3 writes only for explicitly granted scopes", () => {
    expect(visibleExternalTools(principal(["projects:draft"])).map((tool) => tool.name)).toEqual(["draft_research_project"]);
    expect(visibleExternalTools(principal(["research:execute"])).map((tool) => tool.name)).toEqual(["activate_research_project"]);
    expect(visibleExternalTools(principal(["reports:create"])).map((tool) => tool.name)).toEqual(["create_cross_project_report"]);
    expect(visibleExternalTools(principal(["projects:read"])).some((tool) => tool.write)).toBe(false);
  });

  it("uses explicit selected-project access and separate organization access", () => {
    expect(canAccessProject(principal(["projects:read"]), projectId)).toBe(true);
    expect(canAccessProject(principal(["projects:read"]), crypto.randomUUID())).toBe(false);
    expect(canAccessProject(principal(["projects:read"], "organization"), crypto.randomUUID())).toBe(true);
  });
});

describe("external MCP Streamable HTTP gateway", () => {
  it("propagates a revoked credential as an opaque unauthorized response", async () => {
    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    const fetcher = vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 })) as typeof fetch;
    const server = createExternalMcpApp(fetcher).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer revoked", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("revoked");
  });

  it("authenticates, filters discovery, and proxies a structured tool call", async () => {
    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer mti_mcp_test",
        "x-mti-external-gateway-secret": process.env.EXTERNAL_MCP_GATEWAY_SECRET,
        "x-mti-client-ip": expect.any(String)
      });
      if (url.endsWith("/principal")) return Response.json({ data: { tools: ["list_research_projects", "get_project_briefing"] } });
      if (url.endsWith("/invoke")) {
        const request = JSON.parse(String(init?.body)) as { toolName: string };
        if (request.toolName === "get_project_briefing") return Response.json({ data: {
          organization: { id: "30000000-0000-4000-8000-000000000001", name: "MTI", approvedContext: [] },
          externalAssistant: { role: "Collaborator", expectations: ["Use facts"], limits: ["No writes"] },
          project: { id: projectId, name: "Battery", objective: "Research", status: "active", context: "", scope: "", constraints: [], activeStrategy: null, links: { web: "https://example.com" } },
          businessOsAgents: [],
          brainstorming: { topic: "growth", guidance: ["Generate options"], suggestedEvaluationCriteria: ["fit"] },
          warnings: []
        } });
        return Response.json({ data: {
        projects: [{
          id: projectId, name: "Battery", objective: "Research", status: "active", activeStrategyVersionId: null,
          companyCount: 0, dossierCount: 0, lastActivityAt: new Date(0).toISOString(),
          links: { web: `https://example.com/?projectId=${projectId}` }
        }],
        page: { nextCursor: null, hasMore: false }
        } });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const server = createExternalMcpApp(fetcher).listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address");
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);

    expect((await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const client = new Client({ name: "phase-two-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: "Bearer mti_mcp_test" } }
    });
    await client.connect(transport);
    expect(client.getInstructions()).toContain("external conversational collaborator");
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["list_research_projects", "get_project_briefing"]);
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toContain("mti://external-assistant-role");
    expect((await client.listPrompts()).prompts.map((prompt) => prompt.name)).toContain("brainstorm_project");
    const prompt = await client.getPrompt({ name: "brainstorm_project", arguments: { projectId, topic: "growth" } });
    expect(JSON.stringify(prompt.messages)).toContain("authorized MTI Business OS briefing");
    const response = await client.callTool({ name: "list_research_projects", arguments: {} });
    expect(response.structuredContent).toMatchObject({ projects: [{ name: "Battery" }] });
    await client.close();
  });

  it("is conformant for a raw JSON-RPC Streamable HTTP client", async () => {
    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/principal")) return Response.json({ data: { tools: ["list_research_projects"] } });
      return Response.json({ data: { projects: [], page: { nextCursor: null, hasMore: false } } });
    }) as typeof fetch;
    const base = await listen(createExternalMcpApp(fetcher));
    const response = await fetch(new URL("/mcp", base), {
      method: "POST",
      headers: {
        authorization: "Bearer mti_mcp_raw",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await jsonRpc(response))).toContain("list_research_projects");
  });

  it("reports readiness and omits framework identity headers", async () => {
    delete process.env.BUSINESS_OS_INTERNAL_URL;
    delete process.env.EXTERNAL_MCP_GATEWAY_SECRET;
    let base = await listen(createExternalMcpApp());
    let response = await fetch(new URL("/health", base));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-powered-by")).toBeNull();

    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    base = await listen(createExternalMcpApp());
    response = await fetch(new URL("/health", base));
    expect(response.status).toBe(200);
  });

  it("rejects disallowed browser origins and oversized payloads", async () => {
    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    process.env.EXTERNAL_MCP_ALLOWED_ORIGINS = "https://approved.example";
    const base = await listen(createExternalMcpApp());
    const denied = await fetch(new URL("/mcp", base), {
      method: "POST",
      headers: { authorization: "Bearer test", origin: "https://evil.example", "content-type": "application/json" },
      body: "{}"
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const oversized = await fetch(new URL("/mcp", base), {
      method: "POST",
      headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(1_000_001) })
    });
    expect(oversized.status).toBe(413);
  });

  it("requires an explicit allowlist for browser-origin requests", async () => {
    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    const base = await listen(createExternalMcpApp());
    const response = await fetch(new URL("/mcp", base), {
      method: "OPTIONS",
      headers: { origin: "https://browser-client.example" }
    });
    expect(response.status).toBe(403);
  });

  it("turns a private-app timeout into an opaque gateway timeout", async () => {
    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    process.env.EXTERNAL_MCP_INTERNAL_TIMEOUT_MS = "25";
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    const base = await listen(createExternalMcpApp(fetcher));
    const response = await fetch(new URL("/mcp", base), {
      method: "POST",
      headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(504);
    const body = await response.text();
    expect(body).toContain("timed out");
    expect(body).not.toContain("business-os.internal");
  });

  it("handles concurrent discovery traffic and rejects malformed JSON", async () => {
    process.env.BUSINESS_OS_INTERNAL_URL = "http://business-os.internal";
    process.env.EXTERNAL_MCP_GATEWAY_SECRET = "test-gateway-secret-that-is-at-least-32-characters";
    const fetcher = vi.fn(async () => Response.json({ data: { tools: ["list_research_projects"] } })) as typeof fetch;
    const base = await listen(createExternalMcpApp(fetcher));
    const endpoint = new URL("/mcp", base);
    const requests = Array.from({ length: 25 }, (_, index) => fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: "Bearer load-test",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: "tools/list", params: {} })
    }));
    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(25);

    const malformed = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: "Bearer load-test", "content-type": "application/json" },
      body: "{not-valid-json"
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: -32700 }, id: null });
  });
});
