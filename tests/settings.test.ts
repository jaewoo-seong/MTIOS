import { afterEach, describe, expect, it, vi } from "vitest";
import { modelRoutePolicies } from "@/lib/ai/model-policy";
import {
  createModelRouteRevision,
  getActiveModelPolicy,
  getWorkspacePreferences,
  setModelRevisionState,
  updateWorkspacePreferences
} from "@/lib/settings";

afterEach(() => vi.unstubAllEnvs());

describe("workspace settings", () => {
  it("persists English and Korean regional preferences", async () => {
    await updateWorkspacePreferences({
      locale: "ko",
      timezone: "Asia/Seoul",
      dateFormat: "long",
      numberFormat: "locale",
      currency: "KRW"
    });
    expect(await getWorkspacePreferences()).toMatchObject({
      locale: "ko",
      timezone: "Asia/Seoul",
      currency: "KRW"
    });
  });

  it("requires test and approval before route activation", async () => {
    const revision = await createModelRouteRevision("worker_fast", {
      ...modelRoutePolicies.worker_fast,
      maxCostMicros: 20_000
    });
    await expect(setModelRevisionState(revision.id, "approve")).rejects.toThrow(/test/i);
    await setModelRevisionState(revision.id, "test_passed");
    await expect(setModelRevisionState(revision.id, "activate")).rejects.toThrow(/approval/i);
    await setModelRevisionState(revision.id, "approve");
    await setModelRevisionState(revision.id, "activate");
    expect((await getActiveModelPolicy("worker_fast")).maxCostMicros).toBe(20_000);
  });

  it("supports rollback without deleting revision history", async () => {
    const revision = await createModelRouteRevision("worker_editing", modelRoutePolicies.worker_editing);
    await setModelRevisionState(revision.id, "test_passed");
    await setModelRevisionState(revision.id, "approve");
    await setModelRevisionState(revision.id, "activate");
    expect((await setModelRevisionState(revision.id, "rollback")).status).toBe("rolled_back");
  });
});
