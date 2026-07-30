import { describe, expect, it } from "vitest";
import {
  absorbCollectionDirectives,
  addCollectionCandidate,
  addCollectionDirective,
  applyDirectivesToCampaign,
  CAMPAIGN_DEFAULT_CEILING_CENTS,
  CAMPAIGN_MAX_CEILING_CENTS,
  campaignCeilingCents,
  createCollectionCampaign,
  DOSSIER_FANOUT_HARD_LIMIT,
  dossierFanoutLimit,
  findCampaignEvidence,
  getCampaignEvidenceStats,
  getCollectionBudget,
  getCollectionCampaign,
  listCollectionDirectives,
  listPendingDossierCandidates,
  recordCampaignEvidence,
  recordDossierResult,
  reopenCollectionCampaign,
  setCollectionCampaignCeiling
} from "@/lib/collection-research";
import { discoveryStepLimit } from "@/trigger/collection-agent";
import { repository } from "@/lib/repository";

async function testProject(budgetCents: number | null = null) {
  return repository.createProject({
    name: `Campaign controls ${crypto.randomUUID()}`,
    objective: "Verify campaign sizing, steering, and continuation.",
    context: "", scope: "", constraints: [], budgetCents
  });
}

async function campaign(input: {
  ceilingCents?: number | null;
  targetCount?: number | null;
  qualificationRules?: string[];
  budgetCents?: number | null;
} = {}) {
  const project = await testProject(input.budgetCents ?? null);
  return createCollectionCampaign({
    projectId: project.id,
    name: "Controls campaign",
    entitySchema: [{ name: "name", description: "Entity name" }],
    documentTemplate: "# {{name}}",
    dedupeKeys: ["name"],
    qualificationRules: input.qualificationRules,
    targetCount: input.targetCount ?? null,
    ceilingCents: input.ceilingCents ?? null
  });
}

describe("campaign spend ceiling", () => {
  it("lets a campaign authorize more than the low default", async () => {
    // The whole point of the per-campaign field: before it existed, no
    // configuration could authorize a large campaign, because a project budget
    // can only tighten.
    const created = await campaign({ ceilingCents: 5_000 });

    const budget = await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getProjectBudgetCents: async () => null
    });

    expect(budget.ceilingCents).toBe(5_000);
    expect(budget.ceilingSource).toBe("campaign");
  });

  it("still lets a project budget tighten a campaign that authorized more", async () => {
    const created = await campaign({ ceilingCents: 5_000 });

    const budget = await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getProjectBudgetCents: async () => 1_200
    });

    expect(budget.ceilingCents).toBe(1_200);
    expect(budget.ceilingSource).toBe("project");
  });

  it("refuses a ceiling that would read as immediately exhausted", async () => {
    await expect(campaign({ ceilingCents: 0 })).rejects.toThrow(/positive/i);
    await expect(campaign({ ceilingCents: -100 })).rejects.toThrow(/positive/i);
  });

  it("caps an implausibly large ceiling rather than trusting it", async () => {
    const created = await campaign({ ceilingCents: 99_999_999 });
    expect(created.ceilingCents).toBe(CAMPAIGN_MAX_CEILING_CENTS);
  });

  it("raises the ceiling of an existing campaign so it can be continued", async () => {
    const created = await campaign();
    expect(created.ceilingCents).toBeNull();

    const raised = await setCollectionCampaignCeiling(created.id, 2_500);

    expect(raised?.ceilingCents).toBe(2_500);
  });

  it("sizes a new campaign's ceiling from what was actually asked for", () => {
    // An open-ended campaign deliberately stays on the low default: "find
    // everything" is not a spend authorization.
    expect(campaignCeilingCents(null)).toBeNull();
    // A small campaign should not be given less than the default.
    expect(campaignCeilingCents(5)).toBe(CAMPAIGN_DEFAULT_CEILING_CENTS);
    expect(campaignCeilingCents(100)).toBe(1_000);
    expect(campaignCeilingCents(50_000)).toBe(CAMPAIGN_MAX_CEILING_CENTS);
  });
});

describe("campaign research spend accounting", () => {
  it("counts external research credits against the ceiling, not only model calls", async () => {
    const created = await campaign({ ceilingCents: 500 });

    const budget = await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 1_000_000, // 100 cents of model spend
      getResearchCostCents: async () => 380,
      getProjectBudgetCents: async () => null
    });

    expect(budget).toMatchObject({
      modelCostCents: 100,
      researchCostCents: 380,
      spentCents: 480,
      exhausted: false
    });
  });

  it("exhausts a campaign whose research spend alone reaches the ceiling", async () => {
    // This is the case the old accounting could not see at all: no model spend,
    // 400+ search credits, and a guardrail reading zero.
    const created = await campaign({ ceilingCents: 400 });

    const budget = await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 400,
      getProjectBudgetCents: async () => null
    });

    expect(budget.exhausted).toBe(true);
  });

  it("keeps the model and research halves separately reportable", async () => {
    const created = await campaign({ ceilingCents: 5_000 });

    await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 250_000,
      getResearchCostCents: async () => 42,
      getProjectBudgetCents: async () => null
    });

    const stored = await getCollectionCampaign(created.id);
    expect(stored).toMatchObject({ costCents: 67, researchCostCents: 42 });
  });
});

describe("campaign continuation", () => {
  async function campaignWithOutcomes() {
    const created = await campaign({ ceilingCents: 1_000, targetCount: 4 });
    const names = ["Alpha", "Beta", "Gamma", "Delta"];
    const ids: string[] = [];
    for (const name of names) {
      const { candidateId } = await addCollectionCandidate(created.id, { name });
      ids.push(candidateId);
    }
    await recordDossierResult(ids[0], { status: "completed", markdown: "# Alpha" });
    await recordDossierResult(ids[1], { status: "disqualified", reason: "Wrong sector." });
    await recordDossierResult(ids[2], { status: "failed", reason: "Provider timed out." });
    return { campaign: created, ids };
  }

  it("retries transiently failed candidates but leaves judged ones alone", async () => {
    const { campaign: created, ids } = await campaignWithOutcomes();

    const reopened = await reopenCollectionCampaign(created.id, { retryFailed: true });

    expect(reopened.retried).toBe(1);
    const pending = await listPendingDossierCandidates(created.id);
    const pendingIds = pending.map((candidate) => candidate.id);
    // The failed one is back in the queue, alongside the one never attempted.
    expect(pendingIds).toContain(ids[2]);
    expect(pendingIds).toContain(ids[3]);
    // A disqualified candidate was judged against the criteria and stays judged.
    expect(pendingIds).not.toContain(ids[1]);
    expect(pendingIds).not.toContain(ids[0]);
  });

  it("carries spend across a continuation so the ceiling bounds the campaign, not the run", async () => {
    const created = await campaign({ ceilingCents: 500 });
    // First run spends 300 cents.
    await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 300,
      getProjectBudgetCents: async () => null
    });

    await reopenCollectionCampaign(created.id, { retryFailed: false });

    // The continuation is a fresh run: its own counters start at zero. Without
    // carried spend the campaign would look untouched and could spend 500 again
    // on every continuation.
    const budget = await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 150,
      getProjectBudgetCents: async () => null
    });

    expect(budget.spentCents).toBe(450);
    expect(budget.remainingCents).toBe(50);
  });

  it("exhausts a continuation that would push the campaign past its ceiling", async () => {
    const created = await campaign({ ceilingCents: 500 });
    await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 480,
      getProjectBudgetCents: async () => null
    });
    await reopenCollectionCampaign(created.id, { retryFailed: false });

    const budget = await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 25,
      getProjectBudgetCents: async () => null
    });

    expect(budget.exhausted).toBe(true);
  });

  it("does not double-count spend when the continuation load is retried", async () => {
    // The continuation runs as a Trigger.dev task with retries enabled, so its
    // load step can run more than once. Re-freezing spend-to-date would fold
    // the continuation's own spend into the carried figure.
    const created = await campaign({ ceilingCents: 1_000 });
    await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 300,
      getProjectBudgetCents: async () => null
    });

    // First load: the new run has spent nothing, so the snapshot is taken.
    await reopenCollectionCampaign(created.id, { currentRunSpentCents: 0 });
    // The continuation spends 150.
    await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 150,
      getProjectBudgetCents: async () => null
    });
    // Retry of the same load, with the run's spend already on the books.
    await reopenCollectionCampaign(created.id, { currentRunSpentCents: 150 });

    const budget = await getCollectionBudget(created.id, {
      getRunCostMicros: async () => 0,
      getResearchCostCents: async () => 150,
      getProjectBudgetCents: async () => null
    });

    // 300 carried + 150 this run. Not 450 carried + 150.
    expect(budget.spentCents).toBe(450);
  });

  it("only clears saturation when discovery is actually being resumed", async () => {
    const created = await campaign({ ceilingCents: 500 });

    const researchOnly = await reopenCollectionCampaign(created.id, { resumeDiscovery: false });
    expect(researchOnly.campaign?.status).toBe("active");

    const resumed = await reopenCollectionCampaign(created.id, { resumeDiscovery: true });
    expect(resumed.campaign?.saturationReason).toBeNull();
  });
});

describe("derived campaign limits", () => {
  it("gives a 100-entity campaign headroom instead of capping it at exactly 100", () => {
    // The old fixed limit of 100 sat exactly on the most common target, so
    // discovery finding 108 to yield 100 qualifying entities stranded eight.
    expect(dossierFanoutLimit(100)).toBeGreaterThan(100);
    expect(dossierFanoutLimit(100)).toBe(160);
  });

  it("bounds fan-out for an open-ended or runaway campaign", () => {
    expect(dossierFanoutLimit(null)).toBe(DOSSIER_FANOUT_HARD_LIMIT);
    expect(dossierFanoutLimit(100_000)).toBe(DOSSIER_FANOUT_HARD_LIMIT);
  });

  it("scales discovery rounds with the target instead of a fixed fifteen", () => {
    // Fifteen rounds needed ~7 net-new finds every round to reach 100, and a
    // round returning five is normal - so a large campaign reliably stopped
    // short while correctly reporting it had not saturated.
    expect(discoveryStepLimit(100)).toBeGreaterThan(15);
    expect(discoveryStepLimit(100)).toBe(25);
  });

  it("never gives a small campaign fewer rounds than it used to have", () => {
    expect(discoveryStepLimit(5)).toBe(15);
    expect(discoveryStepLimit(null)).toBe(15);
  });

  it("shortens a continuation's discovery to what is still missing", () => {
    // Continuing at 80 of 100 should be a short pass, not a full-length one.
    expect(discoveryStepLimit(100, 80)).toBeLessThan(discoveryStepLimit(100, 0));
    expect(discoveryStepLimit(100, 100)).toBe(15);
  });

  it("caps discovery rounds however large the target is", () => {
    expect(discoveryStepLimit(100_000)).toBe(60);
  });
});

describe("campaign steering", () => {
  it("records a directive as pending until a loop picks it up", async () => {
    const created = await campaign();

    const directive = await addCollectionDirective({
      campaignId: created.id,
      kind: "refocus",
      instruction: "Prioritize manufacturers based in Korea."
    });

    expect(directive.status).toBe("pending");
    expect(await listCollectionDirectives(created.id)).toHaveLength(1);
  });

  it("rejects a steer with no instruction, which would silently do nothing", async () => {
    const created = await campaign();

    await expect(addCollectionDirective({
      campaignId: created.id, kind: "refocus", instruction: "   "
    })).rejects.toThrow(/instruction text/i);
  });

  it("accepts stop_discovery without instruction text, since the kind is the instruction", async () => {
    const created = await campaign();

    const directive = await addCollectionDirective({
      campaignId: created.id, kind: "stop_discovery", instruction: ""
    });

    expect(directive.kind).toBe("stop_discovery");
  });

  it("hands a directive to exactly one poller", async () => {
    // Dossier workers are the concurrent pollers - ten of them run at once, and
    // each polls before claiming its entity. A directive read twice would be
    // applied twice.
    const created = await campaign();
    await addCollectionDirective({
      campaignId: created.id, kind: "add_criteria", instruction: "Must be in Korea."
    });

    const [first, second] = await Promise.all([
      absorbCollectionDirectives(created.id, "dossier"),
      absorbCollectionDirectives(created.id, "dossier")
    ]);

    expect(first.length + second.length).toBe(1);
  });

  it("does not let a dossier worker swallow a directive only discovery can honour", async () => {
    // A dossier worker cannot act on "stop finding things" or on a change of
    // search focus. Absorbing one would mark it applied without applying it.
    const created = await campaign();
    await addCollectionDirective({
      campaignId: created.id, kind: "stop_discovery", instruction: ""
    });
    await addCollectionDirective({
      campaignId: created.id, kind: "refocus", instruction: "Focus on Korea."
    });

    const atDossier = await absorbCollectionDirectives(created.id, "dossier");
    expect(atDossier).toHaveLength(0);

    // Still pending, so the discovery loop - or a later continuation that
    // resumes discovery - picks them up.
    const atScouting = await absorbCollectionDirectives(created.id, "scouting");
    expect(atScouting.map((directive) => directive.kind).sort())
      .toEqual(["refocus", "stop_discovery"]);
  });

  it("still lets a dossier worker take an added criterion, which it can honour", async () => {
    const created = await campaign();
    await addCollectionDirective({
      campaignId: created.id, kind: "add_criteria", instruction: "Must be in Korea."
    });

    const atDossier = await absorbCollectionDirectives(created.id, "dossier");

    expect(atDossier.map((directive) => directive.kind)).toEqual(["add_criteria"]);
  });

  it("marks what it absorbed, so it is never applied again", async () => {
    const created = await campaign();
    await addCollectionDirective({
      campaignId: created.id, kind: "refocus", instruction: "Focus on Korea."
    });

    const absorbed = await absorbCollectionDirectives(created.id, "scouting");
    const again = await absorbCollectionDirectives(created.id, "scouting");


    expect(absorbed).toHaveLength(1);
    expect(absorbed[0].absorbedStage).toBe("scouting");
    expect(again).toHaveLength(0);
  });

  it("persists an added criterion onto the campaign so it outlives the poll", async () => {
    // A criterion added during discovery has to still apply when dossier
    // workers judge qualification, and those workers read the campaign rather
    // than the directive log.
    const created = await campaign({ qualificationRules: ["Must ship hardware."] });
    await addCollectionDirective({
      campaignId: created.id,
      kind: "add_criteria",
      instruction: "Must be headquartered in Korea."
    });

    const absorbed = await absorbCollectionDirectives(created.id, "dossier");
    const updated = await applyDirectivesToCampaign(created.id, absorbed);

    expect(updated?.qualificationRules).toEqual([
      "Must ship hardware.",
      "Must be headquartered in Korea."
    ]);
  });

  it("does not duplicate a criterion that is already on the campaign", async () => {
    const created = await campaign({ qualificationRules: ["Must ship hardware."] });
    await addCollectionDirective({
      campaignId: created.id, kind: "add_criteria", instruction: "Must ship hardware."
    });

    const updated = await applyDirectivesToCampaign(
      created.id,
      await absorbCollectionDirectives(created.id, "dossier")
    );

    expect(updated?.qualificationRules).toEqual(["Must ship hardware."]);
  });

  it("leaves completed dossiers untouched when a criterion is added mid-campaign", async () => {
    // A rule added at entity 60 is not evidence that entities 1-59 were judged
    // wrongly, so steering must not retroactively invalidate finished work.
    const created = await campaign();
    const { candidateId } = await addCollectionCandidate(created.id, { name: "Already done" });
    await recordDossierResult(candidateId, { status: "completed", markdown: "# Already done" });

    await addCollectionDirective({
      campaignId: created.id, kind: "add_criteria", instruction: "Must be in Korea."
    });
    await applyDirectivesToCampaign(
      created.id,
      await absorbCollectionDirectives(created.id, "dossier")
    );

    const pending = await listPendingDossierCandidates(created.id);
    expect(pending.map((candidate) => candidate.id)).not.toContain(candidateId);
  });
});

describe("campaign evidence reuse", () => {
  it("answers an identical question from the pool instead of paying again", async () => {
    const created = await campaign();
    await recordCampaignEvidence({
      campaignId: created.id,
      query: "Acme Corp funding history",
      evidence: { results: ["seed round 2019"] }
    });

    const lookup = await findCampaignEvidence(created.id, "Acme Corp funding history");

    expect(lookup).toMatchObject({ hit: true, matchKind: "exact" });
    expect(lookup.evidence).toEqual({ results: ["seed round 2019"] });
  });

  it("treats punctuation and casing differences as the same question", async () => {
    const created = await campaign();
    await recordCampaignEvidence({
      campaignId: created.id, query: "Acme Corp funding history", evidence: { ok: true }
    });

    const lookup = await findCampaignEvidence(created.id, "  acme corp, FUNDING history!  ");

    expect(lookup.hit).toBe(true);
  });

  it("keeps pools separate per campaign", async () => {
    const first = await campaign();
    const second = await campaign();
    await recordCampaignEvidence({
      campaignId: first.id, query: "shared question", evidence: { from: "first" }
    });

    const lookup = await findCampaignEvidence(second.id, "shared question");

    expect(lookup.hit).toBe(false);
  });

  it("catches a reworded question when embeddings are available", async () => {
    // The research engine's own cache keys on the exact query string, so this
    // near-miss is precisely the duplicated spend it cannot prevent.
    const created = await campaign();
    const vectors: Record<string, number[]> = {
      "Acme Corp funding": [1, 0, 0],
      "Acme Corporation funding rounds": [0.99, 0.14, 0]
    };
    const embed = async (input: string) => vectors[input] ?? [0, 0, 1];

    await recordCampaignEvidence({
      campaignId: created.id,
      query: "Acme Corp funding",
      evidence: { ok: true },
      embedding: vectors["Acme Corp funding"]
    });

    const lookup = await findCampaignEvidence(
      created.id,
      "Acme Corporation funding rounds",
      embed
    );

    expect(lookup).toMatchObject({ hit: true, matchKind: "semantic" });
    expect(lookup.matchedQuery).toBe("Acme Corp funding");
  });

  it("does not treat an unrelated question as a match", async () => {
    const created = await campaign();
    const embed = async (input: string) =>
      input === "Acme Corp funding" ? [1, 0, 0] : [0, 0, 1];
    await recordCampaignEvidence({
      campaignId: created.id,
      query: "Acme Corp funding",
      evidence: { ok: true },
      embedding: [1, 0, 0]
    });

    const lookup = await findCampaignEvidence(created.id, "Widget market size", embed);

    expect(lookup.hit).toBe(false);
  });

  it("falls back to exact matching when embedding is unavailable", async () => {
    // A missing embedding provider should cost some duplicated searches, not
    // stop the campaign - which is the current state of this deployment.
    const created = await campaign();
    const embed = async () => {
      throw new Error("no embedding provider configured");
    };
    await recordCampaignEvidence({
      campaignId: created.id, query: "exact question", evidence: { ok: true }
    });

    await expect(
      findCampaignEvidence(created.id, "exact question", embed)
    ).resolves.toMatchObject({ hit: true, matchKind: "exact" });
    await expect(
      findCampaignEvidence(created.id, "different question", embed)
    ).resolves.toMatchObject({ hit: false });
  });

  it("counts reuse so the saving is visible", async () => {
    const created = await campaign();
    await recordCampaignEvidence({
      campaignId: created.id, query: "counted question", evidence: { ok: true }
    });

    await findCampaignEvidence(created.id, "counted question");
    await findCampaignEvidence(created.id, "counted question");

    expect(await getCampaignEvidenceStats(created.id)).toEqual({
      storedQueries: 1,
      reuseCount: 2
    });
  });

  it("ignores an empty query rather than storing a useless pool entry", async () => {
    const created = await campaign();
    await recordCampaignEvidence({ campaignId: created.id, query: "   ", evidence: { ok: true } });

    expect(await getCampaignEvidenceStats(created.id)).toEqual({
      storedQueries: 0,
      reuseCount: 0
    });
    expect(await findCampaignEvidence(created.id, "  ")).toMatchObject({ hit: false });
  });
});
