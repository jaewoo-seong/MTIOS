import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response, NextFunction } from "express";
import { internalToolCatalog, executeInternalTool, type InternalToolName } from "../../lib/mcp/catalog";

function authorize(request: Request, response: Response, next: NextFunction) {
  const secret = process.env.MCP_SERVICE_SECRET;
  if (!secret) {
    response.status(503).json({ error: "MCP_SERVICE_SECRET is not configured." });
    return;
  }
  if (request.headers.authorization !== `Bearer ${secret}`) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function createInternalMcpServer() {
  const server = new McpServer({
    name: "mti-internal-tools",
    version: "1.0.0"
  });

  for (const tool of internalToolCatalog) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema.shape,
      annotations: {
        readOnlyHint: tool.riskLevel === "low",
        destructiveHint: false,
        idempotentHint: tool.name !== "create_working_report",
        openWorldHint: false
      }
    }, async (input: Record<string, unknown>) => {
      const output = await executeInternalTool(tool.name as InternalToolName, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output as Record<string, unknown>
      };
    });
  }

  server.registerResource(
    "tool-governance",
    "mti://tool-governance",
    {
      title: "MTI tool governance",
      description: "Risk, approval, permission, and budget metadata for internal tools.",
      mimeType: "application/json"
    },
    async () => ({
      contents: [{
        uri: "mti://tool-governance",
        mimeType: "application/json",
        text: JSON.stringify(internalToolCatalog.map((tool) => ({
          name: tool.name,
          group: tool.group,
          riskLevel: tool.riskLevel,
          approvalRequirement: tool.approvalRequirement,
          permissions: tool.permissions,
          budgetCents: tool.budgetCents
        })))
      }]
    })
  );

  server.registerPrompt(
    "scoped-tool-use",
    {
      description: "Rules for selecting tools under project and role scope.",
      argsSchema: {
        role: internalToolCatalog[0].inputSchema.shape.query.optional(),
        projectId: internalToolCatalog[1].inputSchema.shape.projectId.optional()
      }
    },
    async ({ role, projectId }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Role: ${role ?? "worker"}`,
            `Project: ${projectId ?? "none"}`,
            "Use only discovered tools granted to this role and project.",
            "Pause whenever tool metadata requires approval.",
            "Never infer approval from user intent; require a linked approved review."
          ].join("\n")
        }
      }]
    })
  );
  return server;
}

export function createMcpApp() {
  const allowedHosts = [
    "127.0.0.1",
    "localhost",
    "::1",
    process.env.RAILWAY_PRIVATE_DOMAIN
  ].filter((host): host is string => Boolean(host));
  const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts });
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "mcp-tools" });
  });
  app.use("/mcp", authorize);
  app.post("/mcp", async (request, response) => {
    const server = createInternalMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal MCP error."
          },
          id: null
        });
      }
    } finally {
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    }
  });
  app.get("/mcp", (_request, response) => response.status(405).json({ error: "Method not allowed." }));
  app.delete("/mcp", (_request, response) => response.status(405).json({ error: "Method not allowed." }));
  return app;
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3002);
  createMcpApp().listen(port, () => {
    console.log(JSON.stringify({ level: "info", service: "mcp-tools", port }));
  });
}
