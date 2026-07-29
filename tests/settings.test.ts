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
    const first = await createModelRouteRevision("worker_editing", {
      ...modelRoutePolicies.worker_editing,
      maxCostMicros: 40_000
    });
    await setModelRevisionState(first.id, "test_passed");
    await setModelRevisionState(first.id, "approve");
    await setModelRevisionState(first.id, "activate");
    const second = await createModelRouteRevision("worker_editing", {
      ...modelRoutePolicies.worker_editing,
      maxCostMicros: 50_000
    });
    await setModelRevisionState(second.id, "test_passed");
    await setModelRevisionState(second.id, "approve");
    await setModelRevisionState(second.id, "activate");
    expect((await getActiveModelPolicy("worker_editing")).maxCostMicros).toBe(50_000);
    expect((await setModelRevisionState(second.id, "rollback")).status).toBe("rolled_back");
    expect((await getActiveModelPolicy("worker_editing")).maxCostMicros).toBe(40_000);
  });
});
