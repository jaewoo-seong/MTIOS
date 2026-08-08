import { schedules, tasks } from "@trigger.dev/sdk";
import { and, eq, isNotNull } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import { projectResearchSettings } from "@/lib/db/schema";

/**
 * Restarts every eligible project's event-driven research loop. The normal
 * dispatcher/discovery chain does the real work; this heartbeat only makes
 * "continuous" durable across empty search passes, provider outages, and
 * process deployments.
 */
export const continuousResearchHeartbeat = schedules.task({
  id: "continuous-research-heartbeat",
  cron: { pattern: "*/15 * * * *", environments: ["PRODUCTION"] },
  maxDuration: 300,
  run: async ({ timestamp }) => {
    const db = requireDatabase();
    const projects = await db.select({ projectId: projectResearchSettings.projectId })
      .from(projectResearchSettings).where(and(
        eq(projectResearchSettings.discoveryEnabled, true),
        eq(projectResearchSettings.researchPaused, false),
        isNotNull(projectResearchSettings.activeStrategyVersionId)
      ));
    await Promise.all(projects.map(({ projectId }) => tasks.trigger(
      "research-project-dispatcher",
      { projectId },
      { idempotencyKey: `research-heartbeat:${projectId}:${timestamp.toISOString()}` }
    )));
    return { restarted: projects.length };
  }
});
