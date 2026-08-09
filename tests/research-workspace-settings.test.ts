import { describe, expect, it } from "vitest";
import { deriveQueueBufferSettings } from "@/lib/research-workspace";

describe("research workspace queue sizing", () => {
  it("defaults to three queued companies per dossier worker", () => {
    expect(deriveQueueBufferSettings(null, {})).toEqual({
      dossierWorkerLimit: 3,
      queueBufferTarget: 9,
      queueBufferAutomatic: true
    });
    expect(deriveQueueBufferSettings({ dossierWorkerLimit: 3, queueBufferTarget: 9, queueBufferAutomatic: true }, {
      dossierWorkerLimit: 5
    }).queueBufferTarget).toBe(15);
  });

  it("turns a direct queue adjustment into a project-level manual override", () => {
    const manual = deriveQueueBufferSettings({ dossierWorkerLimit: 3, queueBufferTarget: 9, queueBufferAutomatic: true }, {
      queueBufferTarget: 10
    });
    expect(manual.queueBufferAutomatic).toBe(false);
    expect(deriveQueueBufferSettings(manual, { dossierWorkerLimit: 5 }).queueBufferTarget).toBe(10);
  });

  it("restores the three-times rule when automatic mode is selected", () => {
    expect(deriveQueueBufferSettings({ dossierWorkerLimit: 5, queueBufferTarget: 10, queueBufferAutomatic: false }, {
      queueBufferAutomatic: true
    })).toEqual({ dossierWorkerLimit: 5, queueBufferTarget: 15, queueBufferAutomatic: true });
  });
});
