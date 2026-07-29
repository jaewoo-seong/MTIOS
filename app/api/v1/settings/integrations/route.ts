import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mcpServers } from "@/lib/db/schema";
import { registerInternalMcpServer } from "@/lib/mcp/platform";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export async function GET() {
  const registered = await registerInternalMcpServer();
  const servers = db
    ? await db.select({
      id: mcpServers.id,
      name: mcpServers.name,
      transport: mcpServers.transport,
      status: mcpServers.status,
      healthStatus: mcpServers.healthStatus,
      lastHealthCheckAt: mcpServers.lastHealthCheckAt,
      capabilities: mcpServers.capabilities
    }).from(mcpServers).where(and(
      eq(mcpServers.organizationId, MTI_ORGANIZATION_ID),
      eq(mcpServers.status, "active")
    ))
    : [{
      id: registered.server.id,
      name: registered.server.name,
      transport: "streamable_http",
      status: "active",
      healthStatus: process.env.MCP_SERVICE_URL && process.env.MCP_SERVICE_SECRET
        ? "configured"
        : "not_configured",
      lastHealthCheckAt: null,
      capabilities: { tools: true, resources: true, prompts: true }
    }];

  return NextResponse.json({
    mcp: {
      servers,
      authenticationConfigured: Boolean(process.env.MCP_SERVICE_SECRET)
    },
    gmail: {
      oauthConfigured: Boolean(
        process.env.GOOGLE_GMAIL_CLIENT_ID &&
        process.env.GOOGLE_GMAIL_CLIENT_SECRET &&
        process.env.GMAIL_TOKEN_ENCRYPTION_KEY
      ),
      scopes: ["gmail.readonly", "gmail.compose"],
      sendEnabled: false
    }
  });
}
