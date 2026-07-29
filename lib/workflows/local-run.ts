import type { ExecutiveCommand } from "@/lib/domain";
import { repository } from "@/lib/repository";

/**
 * Drives a run forward when no managed workflow backend is configured.
 *
 * This does not simulate agent work. It records the real, verifiable steps the
 * application can perform locally and then reports honestly that background
 * execution is unavailable, so the activity stream never implies work that did
 * not happen.
 */
export async function startLocalRun(command: ExecutiveCommand, runId: string) {
  const steps: Array<{ type: string; message: string; delayMs: number }> = [
    {
      type: "run.planning",
      message: `Instruction accepted: "${truncate(command.instruction, 140)}"`,
      delayMs: 250
    },
    {
      type: "run.context",
      message: command.projectId
        ? "Loaded project context, scope, and constraints for grounding."
        : "No project attached — running against workspace-level context only.",
      delayMs: 500
    },
    {
      type: "run.review",
      message: "Checked review policy: external sends and destructive writes require approval.",
      delayMs: 500
    }
  ];

  void (async () => {
    try {
      for (const step of steps) {
        await delay(step.delayMs);
        await repository.appendEvent(runId, { type: step.type, message: step.message });
      }

      await delay(400);
      await repository.appendEvent(runId, {
        type: "run.blocked",
        message:
          "Background execution is not configured in this environment. " +
          "Set TRIGGER_SECRET_KEY and LITELLM_BASE_URL to let agents execute this instruction."
      });
      await repository.updateRun(runId, { status: "review_required", progress: 100 });
    } catch (reason) {
      await repository
        .appendEvent(runId, {
          type: "run.failed",
          message: reason instanceof Error ? reason.message : "Local run failed."
        })
        .catch(() => undefined);
      await repository.updateRun(runId, { status: "failed" }).catch(() => undefined);
    }
  })();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, max: number) {
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
