import { NextResponse } from "next/server";
import { listAllowedMcpTools } from "@/lib/mcp/platform";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
export const GET = guard(async (request) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const agentId = url.searchParams.get("agentId");
  const agents = await repository.listAgentDefinitions();
  const agent = agentId
    ? agents.find((item) => item.id === agentId)
    : agents.find((item) => item.role === "executive");
  if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  return NextResponse.json({
    data: await listAllowedMcpTools({
      role: agent.role,
      projectId,
      permissions: agent.toolScopes
    })
  });
});
