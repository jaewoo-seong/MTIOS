import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { NextFunction, Request, Response } from "express";
import { externalMcpToolCatalog, getProjectBriefingInput } from "../../lib/mcp/external-contracts";

type Fetcher = typeof fetch;
const descriptions: Record<string, string> = {
  list_research_projects: "List research projects authorized for this MCP credential.",
  get_research_project: "Get one bounded research project overview, strategy, status, and counts.",
  get_project_briefing: "Give the external assistant a bounded briefing about MTI, one authorized project, the active strategy, constraints, and Business OS agent responsibilities before brainstorming.",
  search_business_os: "Search authorized companies, dossiers, documents, and cited evidence.",
  get_company_research: "Get the authorized Business OS record, primary dossier, and evidence summary for one company.",
  get_document: "Retrieve one authorized document as bounded Markdown with revision and provenance metadata.",
  draft_research_project: "Create an idempotent draft Business OS project and proposed strategy from bounded conversation context. This does not start research and always requires later approval.",
  activate_research_project: "Activate one proposed strategy and start the existing governed research pipeline. Requires research:execute, exact confirmation text, and an idempotency key.",
  create_cross_project_report: "Create an idempotent, traceable report from exact approved document revisions across authorized projects. Defaults to approved dossiers and never silently includes working material."
};

export const externalMcpInstructions = [
  "MTI Business OS is the system of record for governed company research, dossiers, evidence, documents, and project strategy.",
  "You are an external conversational collaborator, not an autonomous internal MTI agent.",
  "Before brainstorming or advising on a project, call get_project_briefing and use only its authorized project and approved organization context.",
  "Clearly label Business OS facts, your inferences, and creative hypotheses.",
  "Drafting, activation, and other writes are separate operations. Never treat conversation text as approval to start paid research."
].join("\n");

export function createExternalMcpServer(allowedToolNames: string[], authorization: string, fetcher: Fetcher = fetch, clientIp = "unknown-origin") {
  const server = new McpServer(
    { name: "mti-business-os", version: "0.3.0" },
    { instructions: externalMcpInstructions }
  );
  const allowed = new Set(allowedToolNames);
  for (const tool of externalMcpToolCatalog) {
    if (!allowed.has(tool.name) || !(tool.name in descriptions)) continue;
    server.registerTool(tool.name, {
      description: descriptions[tool.name],
      inputSchema: tool.inputSchema.shape,
      outputSchema: tool.outputSchema.shape,
      annotations: { readOnlyHint: !tool.write, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (input: Record<string, unknown>) => {
      const response = await callBusinessOs("/api/internal/external-mcp/invoke", authorization, fetcher, {
        toolName: tool.name,
        arguments: input
      }, clientIp);
      const output = (response as { data: Record<string, unknown> }).data;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output
      };
    });
  }
  server.registerResource(
    "external-assistant-role",
    "mti://external-assistant-role",
    {
      title: "MTI external assistant role",
      description: "How Codex, Claude, Gemini, and other external assistants should collaborate with MTI Business OS.",
      mimeType: "text/plain"
    },
    async () => ({ contents: [{ uri: "mti://external-assistant-role", mimeType: "text/plain", text: externalMcpInstructions }] })
  );
  if (allowed.has("get_project_briefing")) {
    server.registerPrompt(
      "brainstorm_project",
      {
        title: "Brainstorm for an MTI project",
        description: "Load an authorized MTI/project briefing and structure an evidence-aware brainstorming conversation.",
        argsSchema: {
          projectId: getProjectBriefingInput.shape.projectId,
          topic: getProjectBriefingInput.shape.topic.optional()
        }
      },
      async ({ projectId, topic }) => {
        const response = await callBusinessOs("/api/internal/external-mcp/invoke", authorization, fetcher, {
          toolName: "get_project_briefing",
          arguments: { projectId, topic: topic ?? "", includeOrganizationContext: true }
        }, clientIp);
        const briefing = (response as { data: Record<string, unknown> }).data;
        return { messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Use this authorized MTI Business OS briefing to brainstorm with me.",
              "Propose distinct ideas; for each include rationale, MTI/project fit, assumptions, evidence needed, risks, and next step.",
              "Do not present hypotheses as stored facts or initiate any write/paid action.",
              JSON.stringify(briefing)
            ].join("\n\n")
          }
        }] };
      }
    );
  }
  return server;
}

export function createExternalMcpApp(fetcher: Fetcher = fetch) {
  const configuredHosts = (process.env.EXTERNAL_MCP_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean);
  const allowedHosts = ["127.0.0.1", "localhost", "::1", process.env.RAILWAY_PUBLIC_DOMAIN, ...configuredHosts]
    .filter((host): host is string => Boolean(host));
  const allowedOrigins = new Set((process.env.EXTERNAL_MCP_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
  const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts });
  app.disable("x-powered-by");
  app.get("/health", (_request, response) => {
    const ready = Boolean(process.env.BUSINESS_OS_INTERNAL_URL) && (process.env.EXTERNAL_MCP_GATEWAY_SECRET?.length ?? 0) >= 32;
    return response.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "not_ready",
      service: "mcp-external",
      version: "0.3.0"
    });
  });
  app.use("/mcp", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (contentLength > 1_000_000) {
      response.status(413).json({ error: "request_too_large" });
      return;
    }
    next();
  });
  app.post("/mcp", async (request: Request, response: Response) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    let server: McpServer | null = null;
    let transport: StreamableHTTPServerTransport | null = null;
    try {
      const clientIp = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown-origin").split(",")[0].trim();
      const principal = await callBusinessOs("/api/internal/external-mcp/principal", authorization, fetcher, undefined, clientIp);
      const toolNames = (principal as { data: { tools: string[] } }).data.tools;
      server = createExternalMcpServer(toolNames, authorization, fetcher, clientIp);
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) {
        const status = error instanceof GatewayResponseError ? error.status : 500;
        response.status(status).json({
          jsonrpc: "2.0",
          error: { code: status === 401 ? -32001 : status === 504 ? -32002 : -32603, message: status === 401 ? "Unauthorized" : status === 504 ? "Business OS MCP request timed out." : "Business OS MCP request failed." },
          id: null
        });
      }
    } finally {
      await transport?.close();
      await server?.close();
    }
  });
  app.options("/mcp", (request, response) => {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) return response.status(403).end();
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Vary", "Origin");
    return response.status(204).end();
  });
  app.get("/mcp", (_request, response) => response.status(405).json({ error: "method_not_allowed" }));
  app.delete("/mcp", (_request, response) => response.status(405).json({ error: "method_not_allowed" }));
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Invalid JSON request." },
        id: null
      });
      return;
    }
    next(error);
  });
  return app;
}

async function callBusinessOs(path: string, authorization: string, fetcher: Fetcher, body?: Record<string, unknown>, clientIp?: string) {
  const baseUrl = process.env.BUSINESS_OS_INTERNAL_URL?.replace(/\/$/, "");
  const gatewaySecret = process.env.EXTERNAL_MCP_GATEWAY_SECRET;
  if (!baseUrl || !gatewaySecret) throw new GatewayResponseError(503);
  let response: globalThis.Response;
  try {
    response = await fetcher(`${baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization,
        "x-mti-external-gateway-secret": gatewaySecret,
        ...(clientIp ? { "x-mti-client-ip": clientIp } : {}),
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(internalTimeoutMs())
    });
  } catch (error) {
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw new GatewayResponseError(504);
    throw error;
  }
  if (!response.ok) throw new GatewayResponseError(response.status);
  return response.json();
}

function internalTimeoutMs() {
  const configured = Number(process.env.EXTERNAL_MCP_INTERNAL_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(configured) ? Math.max(25, Math.min(60_000, configured)) : 15_000;
}

class GatewayResponseError extends Error {
  constructor(public status: number) { super(`gateway_${status}`); }
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3004);
  createExternalMcpApp().listen(port, () => {
    console.log(JSON.stringify({ level: "info", service: "mcp-external", port }));
  });
}
