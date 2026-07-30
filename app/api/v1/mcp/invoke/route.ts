import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { clampCostCeiling, invokeMcpTool } from "@/lib/mcp/platform";
import { repository } from "@/lib/repository";

const schema = z.object({
  toolName: z.string().trim().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()).default({}),
  agentId: z.string().uuid().optional(),
  projectId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  workerRunId: z.string().uuid().nullable().optional(),
  approvedReviewId: z.string().uuid().nullable().optional(),
  maxCostCents: z.number().int().min(0).nullable().optional()
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const agents = await repository.listAgentDefinitions();
  const agent = parsed.data.agentId
    ? agents.find((item) => item.id === parsed.data.agentId)
    : agents.find((item) => item.role === "executive");
  if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  try {
    const result = await invokeMcpTool({
      toolName: parsed.data.toolName,
      arguments: parsed.data.arguments ?? {},
      approvedReviewId: parsed.data.approvedReviewId,
      scope: {
        role: agent.role,
        projectId: parsed.data.projectId,
        runId: parsed.data.runId,
        workerRunId: parsed.data.workerRunId,
        permissions: agent.toolScopes,
        // The caller may only tighten the agent's configured ceiling, never
        // raise it — otherwise a client-supplied maxCostCents widens the
        // agent's real spending limit instead of scoping a single call under it.
        maxCostCents: clampCostCeiling(parsed.data.maxCostCents, agent.budgetCents)
      }
    });
    return NextResponse.json({ data: result }, {
      status: result.status === "approval_required" ? 202 : 200
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "MCP invocation failed."
    }, { status: 403 });
  }
}
