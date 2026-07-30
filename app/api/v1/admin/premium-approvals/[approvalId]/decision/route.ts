import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { guard } from "@/lib/api/guard";
import { requireDatabase } from "@/lib/db/client";
import {
  premiumModelApprovals,
  runs,
  workflowStates
} from "@/lib/db/schema";
import { parseJson } from "@/lib/http";
import { logger } from "@/lib/observability/logger";
import { repository, MTI_ORGANIZATION_ID } from "@/lib/repository";
import { dispatchCommand } from "@/lib/workflows/trigger";
import { registerWorkflowRun } from "@/lib/workflows/state";

const schema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(4000).default("")
});

/**
 * `expensive` because approving resumes a workflow onto a paid model route -
 * this is the endpoint that converts a parked run back into spend.
 */
export const POST = guard<{ approvalId: string }>(async (request, { params, session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const database = requireDatabase();
  const [approval] = await database.select().from(premiumModelApprovals).where(and(
    eq(premiumModelApprovals.id, params.approvalId),
    eq(premiumModelApprovals.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  if (!approval) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (approval.status !== "pending") {
    return NextResponse.json({ error: "approval_already_decided" }, { status: 409 });
  }
  const [run] = await database.select().from(runs).where(eq(runs.id, approval.runId)).limit(1);
  if (!run) return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  const now = new Date();
  await database.update(premiumModelApprovals).set({
    status: parsed.data.decision,
    decidedBy: session.userId,
    decidedAt: now,
    decisionNote: parsed.data.note ?? "",
    updatedAt: now
  }).where(eq(premiumModelApprovals.id, approval.id));
  logger.info("admin.premium_decision", {
    approvalId: approval.id,
    runId: run.id,
    decision: parsed.data.decision,
    actorId: session.userId
  });
  if (parsed.data.decision === "rejected") {
    await repository.updateRun(run.id, { status: "cancelled" });
    await repository.updateCommand(run.commandId, { status: "cancelled" });
    await repository.appendEvent(run.id, {
      type: "run.premium_rejected",
      message: "Administrator rejected premium model fallback."
    });
    await database.update(workflowStates).set({
      status: "cancelled",
      terminalAt: now,
      checkpoint: { phase: "premium_rejected", approvalId: params.approvalId },
      updatedAt: now
    }).where(eq(workflowStates.runId, run.id));
    return NextResponse.json({ data: { status: "rejected", resumed: false } });
  }
  await repository.updateRun(run.id, { status: "queued", progress: 0 });
  await repository.updateCommand(run.commandId, { status: "confirmed" });
  const dispatch = await dispatchCommand(
    run.commandId,
    run.id,
    `${run.commandId}:premium:${approval.id}`
  );
  await repository.updateRun(run.id, { workflowRunId: dispatch.workflowRunId });
  await registerWorkflowRun(run.id, dispatch.workflowRunId);
  await repository.appendEvent(run.id, {
    type: "run.premium_approved",
    message: "Administrator approved premium model fallback; workflow resumed."
  });
  return NextResponse.json({
    data: { status: "approved", resumed: true, workflow: dispatch }
  });
}, { admin: true, rateLimit: "expensive" });
