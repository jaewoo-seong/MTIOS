import { describe, expect, it } from "vitest";
import {
  addCollectionCandidate,
  claimCollectionCandidate,
  CAMPAIGN_DEFAULT_CEILING_CENTS,
  createCollectionCampaign,
  crossLinkCollectionCampaign,
  DOSSIER_DOCUMENT_COLUMN,
  getCollectionBudget,
  getCollectionCoverage,
  listCollectionCandidates,
  listPendingDossierCandidates,
  markCollectionCampaignSaturated,
  reconcileCollectionRecordLinks,
  recordDossierResult,
  releaseCollectionCandidateClaim,
  setCollectionCandidateLinks
} from "@/lib/collection-research";
import {
  createClientChangeSet,
  getClientChangeSet,
  submitClientChangeSet
} from "@/lib/client-changes";
import { repository } from "@/lib/repository";

async function testProject() {
  return repository.createProject({
    name: `Collection test project ${crypto.randomUUID()}`,
    objective: "Verify the generic collection ledger end to end.",
    context: "", scope: "", constraints: [], budgetCents: null
  });
}

describe("Stage 1 - Generic Ledger", () => {
  it("rejects a campaign with no dedupe key", async () => {
    const project = await testProject();
    await expect(createCollectionCampaign({
      projectId: project.id,
      name: "No dedupe key",
      entitySchema: [{ name: "title", description: "Paper title" }],
      documentTemplate: "# {{title}}",
      dedupeKeys: []
    })).rejects.toThrow(/dedupe key/i);
  });

  it("dedupes candidates on the campaign's own declared keys, not company-specific fields", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Academic papers on X",
      entitySchema: [
        { name: "title", description: "Paper title" },
        { name: "authors", description: "Author list" }
      ],
      documentTemplate: "# {{title}}\n\nBy {{authors}}",
      dedupeKeys: ["title"],
      targetCount: 10
    });

    const first = await addCollectionCandidate(campaign.id, {
      title: "Deep Learning for Widget Classification",
      authors: "A. Researcher"
    });
    expect(first.resolution).toBe("new");

    // Same title, different casing/whitespace, different authors field —
    // still the same paper by the campaign's own dedupe key.
    const duplicate = await addCollectionCandidate(campaign.id, {
      title: "  DEEP learning FOR Widget Classification  ",
      authors: "A. Researcher, B. Coauthor"
    });
    expect(duplicate.resolution).toBe("duplicate");
    expect(duplicate.candidateId).toBe(first.candidateId);

    const second = await addCollectionCandidate(campaign.id, {
      title: "A Different Paper Entirely",
      authors: "C. Other"
    });
    expect(second.resolution).toBe("new");
    expect(second.candidateId).not.toBe(first.candidateId);

    const candidates = await listCollectionCandidates(campaign.id);
    expect(candidates).toHaveLength(2);
  });

  it("reports coverage against the target count as candidates are discovered", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Coverage check",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"],
      targetCount: 3
    });
    await addCollectionCandidate(campaign.id, { name: "One" });
    await addCollectionCandidate(campaign.id, { name: "Two" });
    await addCollectionCandidate(campaign.id, { name: "One" }); // duplicate

    const coverage = await getCollectionCoverage(campaign.id);
    expect(coverage).toMatchObject({ discovered: 2, duplicates: 1, remaining: 1, saturated: false });
  });

  it("reports unbounded remaining when a campaign has no target count", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Open-ended",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const coverage = await getCollectionCoverage(campaign.id);
    expect(coverage?.remaining).toBeNull();
  });

  it("prevents two workers from claiming the same candidate at once", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Claim exclusivity",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const { candidateId } = await addCollectionCandidate(campaign.id, { name: "Contested Entity" });

    const first = await claimCollectionCandidate({ campaignId: campaign.id, candidateId });
    expect(first).not.toBeNull();

    const second = await claimCollectionCandidate({ campaignId: campaign.id, candidateId });
    expect(second).toBeNull();
  });

  it("lets a candidate be reclaimed after its lease is released", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Reclaim after release",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const { candidateId } = await addCollectionCandidate(campaign.id, { name: "Released Entity" });

    const claim = await claimCollectionCandidate({ campaignId: campaign.id, candidateId });
    expect(claim).not.toBeNull();
    const released = await releaseCollectionCandidateClaim(campaign.id, candidateId, claim!.leaseToken);
    expect(released).toBe(true);

    const reclaim = await claimCollectionCandidate({ campaignId: campaign.id, candidateId });
    expect(reclaim).not.toBeNull();
  });

  it("lets an expired lease be reclaimed without an explicit release", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Expired lease",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const { candidateId } = await addCollectionCandidate(campaign.id, { name: "Abandoned Entity" });

    const claim = await claimCollectionCandidate({
      campaignId: campaign.id, candidateId, leaseSeconds: -1
    });
    expect(claim).not.toBeNull();

    const reclaim = await claimCollectionCandidate({ campaignId: campaign.id, candidateId });
    expect(reclaim).not.toBeNull();
  });

  it("records where Stage 5 linked a candidate's record and document", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Linkage",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const { candidateId } = await addCollectionCandidate(campaign.id, { name: "Linked Entity" });

    const linked = await setCollectionCandidateLinks(candidateId, {
      recordId: "11111111-1111-4111-8111-111111111111",
      documentId: "22222222-2222-4222-8222-222222222222"
    });
    expect(linked).toMatchObject({
      linkedRecordId: "11111111-1111-4111-8111-111111111111",
      linkedDocumentId: "22222222-2222-4222-8222-222222222222"
    });
  });

  it("marks a campaign saturated with a reason", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Saturation",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const saturated = await markCollectionCampaignSaturated(
      campaign.id,
      "No new distinct entities across five consecutive search rounds."
    );
    expect(saturated?.status).toBe("saturated");
    const coverage = await getCollectionCoverage(campaign.id);
    expect(coverage?.saturated).toBe(true);
  });
});

describe("Stage 4 - Dossier ledger", () => {
  async function campaignWithCandidates(names: string[]) {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Dossier ledger",
      entitySchema: [
        { name: "name", description: "Entity name" },
        { name: "founded", description: "Year founded" }
      ],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const ids = [];
    for (const name of names) {
      ids.push((await addCollectionCandidate(campaign.id, { name })).candidateId);
    }
    return { campaign, ids };
  }

  it("lists only candidates that still need a dossier", async () => {
    const { campaign, ids } = await campaignWithCandidates(["Alpha", "Beta"]);
    expect(await listPendingDossierCandidates(campaign.id)).toHaveLength(2);

    await recordDossierResult(ids[0], { status: "completed", markdown: "# Alpha" });

    const pending = await listPendingDossierCandidates(campaign.id);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(ids[1]);
  });

  it("merges extracted fields over what discovery already knew, rather than replacing them", async () => {
    const { ids } = await campaignWithCandidates(["Gamma"]);

    const updated = await recordDossierResult(ids[0], {
      status: "completed",
      data: { founded: "1998" },
      markdown: "# Gamma"
    });

    // The discovery-time `name` must survive a dossier that only found `founded`.
    expect(updated?.data).toMatchObject({ name: "Gamma", founded: "1998" });
    expect(updated?.dossierMarkdown).toBe("# Gamma");
  });

  it("counts completed and disqualified dossiers separately on the campaign", async () => {
    const { campaign, ids } = await campaignWithCandidates(["Delta", "Epsilon", "Zeta"]);

    await recordDossierResult(ids[0], { status: "completed", markdown: "# Delta" });
    await recordDossierResult(ids[1], { status: "disqualified", reason: "Not fundraising." });
    await recordDossierResult(ids[2], { status: "failed", reason: "Search provider down." });

    const coverage = await getCollectionCoverage(campaign.id);
    expect(coverage).toMatchObject({ discovered: 3, accepted: 1, rejected: 1 });
    // A failed dossier is neither accepted nor rejected - the entity was never judged.
    expect(coverage!.accepted + coverage!.rejected).toBe(2);
  });

  it("leaves a failed candidate out of the pending list so it is not silently retried forever", async () => {
    const { campaign, ids } = await campaignWithCandidates(["Eta"]);
    await recordDossierResult(ids[0], { status: "failed", reason: "Model returned nothing." });

    expect(await listPendingDossierCandidates(campaign.id)).toHaveLength(0);
    const candidates = await listCollectionCandidates(campaign.id);
    expect(candidates[0]).toMatchObject({ dossierStatus: "failed", dossierReason: "Model returned nothing." });
  });
});

describe("Stage 5 - Cross-Link", () => {
  function crossLinkDeps() {
    const documents: Array<{ id: string; title: string; markdown: string }> = [];
    const databases: Array<{ id: string; name: string }> = [];
    const changeSets: Array<{
      id: string;
      databaseId: string;
      idempotencyKey: string;
      items: Array<{ operation: "insert"; after: Record<string, string> }>;
    }> = [];
    const submitted: string[] = [];
    return {
      documents, databases, changeSets, submitted,
      deps: {
        resolveFolderId: async () => "folder-1",
        createDocument: async (input: { title: string; markdown: string }) => {
          const document = { id: crypto.randomUUID(), title: input.title, markdown: input.markdown };
          documents.push(document);
          return document;
        },
        ensureDatabase: async (name: string) => {
          const database = { id: crypto.randomUUID(), name };
          databases.push(database);
          return database;
        },
        createChangeSet: async (input: {
          databaseId: string;
          idempotencyKey: string;
          items: Array<{ operation: "insert"; after: Record<string, string> }>;
        }) => {
          const set = { id: crypto.randomUUID(), ...input };
          changeSets.push(set);
          return set;
        },
        submitChangeSet: async (id: string) => { submitted.push(id); }
      }
    };
  }

  async function campaignWithDossiers() {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Kickstarter hardware",
      entitySchema: [
        { name: "companyName", description: "Company name" },
        { name: "fundingGoal", description: "Funding goal" }
      ],
      documentTemplate: "# {{companyName}}",
      dedupeKeys: ["companyName"]
    });
    const first = await addCollectionCandidate(campaign.id, { companyName: "Acme Robotics" });
    const second = await addCollectionCandidate(campaign.id, { companyName: "Bolt Devices" });
    await recordDossierResult(first.candidateId, {
      status: "completed", data: { fundingGoal: "$50,000" }, markdown: "# Acme Robotics"
    });
    await recordDossierResult(second.candidateId, {
      status: "completed", data: { fundingGoal: "$12,000" }, markdown: "# Bolt Devices"
    });
    return { campaign, ids: [first.candidateId, second.candidateId] };
  }

  it("creates a document per dossier and stages the rows as one change set", async () => {
    const { campaign } = await campaignWithDossiers();
    const harness = crossLinkDeps();

    const result = await crossLinkCollectionCampaign(campaign.id, harness.deps);

    expect(result.published).toBe(2);
    expect(harness.documents).toHaveLength(2);
    expect(harness.changeSets).toHaveLength(1);
    expect(harness.changeSets[0].items).toHaveLength(2);
    // The change set must be submitted for review, not left as a draft nobody sees.
    expect(harness.submitted).toEqual([harness.changeSets[0].id]);
  });

  it("does not create client records directly - only a reviewable proposal", async () => {
    const { campaign } = await campaignWithDossiers();
    // Real staged-change flow here, not a stub: the point of this test is that
    // the actual Phase 8 path leaves the database untouched until approval.
    const database = await repository.createClientDatabase({
      name: `Cross-link target ${crypto.randomUUID()}`,
      description: "Real database for the staged-change path."
    });
    const documents: string[] = [];

    const result = await crossLinkCollectionCampaign(campaign.id, {
      resolveFolderId: async () => (await repository.createFolder("Collected dossiers")).id,
      createDocument: async (input) => {
        const document = await repository.createDocument({
          folderId: input.folderId,
          projectId: input.projectId,
          title: input.title,
          filename: `${input.title}.md`,
          mimeType: "text/markdown",
          sourceKind: "text",
          sizeBytes: input.markdown.length,
          pageCount: null,
          wordCount: 2,
          markdown: input.markdown,
          storageKey: null
        });
        documents.push(document.id);
        return document;
      },
      ensureDatabase: async () => database,
      createChangeSet: (set) => createClientChangeSet(set),
      submitChangeSet: (id) => submitClientChangeSet(id)
    });

    expect(result.published).toBe(2);
    expect(documents).toHaveLength(2);
    // Nothing may exist in the database itself until a human approves the set.
    expect(await repository.listRecords(database.id)).toHaveLength(0);
    const changeSet = await getClientChangeSet(result.changeSetId!);
    expect(changeSet?.status).toBe("review_required");
    expect(changeSet?.items.every((item) => item.operation === "insert")).toBe(true);
  });

  it("links each proposed row to its own dossier document", async () => {
    const { campaign, ids } = await campaignWithDossiers();
    const harness = crossLinkDeps();

    await crossLinkCollectionCampaign(campaign.id, harness.deps);

    const candidates = await listCollectionCandidates(campaign.id);
    const documentIds = candidates.map((candidate) => candidate.linkedDocumentId);
    expect(documentIds.filter(Boolean)).toHaveLength(ids.length);
    for (const item of harness.changeSets[0].items) {
      expect(documentIds).toContain(item.after[DOSSIER_DOCUMENT_COLUMN]);
    }
  });

  it("includes only the campaign's declared fields as columns", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Declared fields only",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const { candidateId } = await addCollectionCandidate(campaign.id, { name: "Theta" });
    await recordDossierResult(candidateId, {
      status: "completed",
      data: { unexpectedField: "should not become a column" },
      markdown: "# Theta"
    });
    const harness = crossLinkDeps();

    await crossLinkCollectionCampaign(campaign.id, harness.deps);

    expect(Object.keys(harness.changeSets[0].items[0].after).sort())
      .toEqual([DOSSIER_DOCUMENT_COLUMN, "name"].sort());
  });

  it("skips dossiers that were already published instead of duplicating them", async () => {
    const { campaign } = await campaignWithDossiers();
    const first = crossLinkDeps();
    await crossLinkCollectionCampaign(campaign.id, first.deps);

    const second = crossLinkDeps();
    const rerun = await crossLinkCollectionCampaign(campaign.id, second.deps);

    expect(rerun.published).toBe(0);
    expect(rerun.skipped).toBe(2);
    expect(second.documents).toHaveLength(0);
    expect(second.changeSets).toHaveLength(0);
  });

  it("ignores candidates whose dossier is not completed", async () => {
    const project = await testProject();
    const campaign = await createCollectionCampaign({
      projectId: project.id,
      name: "Mixed outcomes",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
    const good = await addCollectionCandidate(campaign.id, { name: "Iota" });
    const bad = await addCollectionCandidate(campaign.id, { name: "Kappa" });
    await addCollectionCandidate(campaign.id, { name: "Lambda" }); // still pending
    await recordDossierResult(good.candidateId, { status: "completed", markdown: "# Iota" });
    await recordDossierResult(bad.candidateId, { status: "disqualified", reason: "Out of scope." });
    const harness = crossLinkDeps();

    const result = await crossLinkCollectionCampaign(campaign.id, harness.deps);

    expect(result.published).toBe(1);
    expect(harness.documents[0].title).toBe("Iota");
  });

  it("withholds record links while the change set is still awaiting approval", async () => {
    const { campaign } = await campaignWithDossiers();
    const harness = crossLinkDeps();
    await crossLinkCollectionCampaign(campaign.id, harness.deps);

    const result = await reconcileCollectionRecordLinks(campaign.id, {
      getChangeSetStatus: async () => "review_required",
      listRecords: async () => []
    });

    expect(result).toMatchObject({ linked: 0, pendingApproval: true });
    const candidates = await listCollectionCandidates(campaign.id);
    expect(candidates.every((candidate) => candidate.linkedRecordId === null)).toBe(true);
  });

  it("completes the record link once the change set has been applied", async () => {
    const { campaign } = await campaignWithDossiers();
    const harness = crossLinkDeps();
    await crossLinkCollectionCampaign(campaign.id, harness.deps);
    const items = harness.changeSets[0].items;

    const result = await reconcileCollectionRecordLinks(campaign.id, {
      getChangeSetStatus: async () => "applied",
      listRecords: async () => items.map((item, index) => ({
        id: `record-${index}`,
        data: item.after
      }))
    });

    expect(result).toMatchObject({ linked: 2, pendingApproval: false });
    const candidates = await listCollectionCandidates(campaign.id);
    for (const candidate of candidates) {
      const expected = items.findIndex(
        (item) => item.after[DOSSIER_DOCUMENT_COLUMN] === candidate.linkedDocumentId
      );
      expect(candidate.linkedRecordId).toBe(`record-${expected}`);
    }
  });
});

describe("Guardrails - campaign budget", () => {
  async function budgetCampaign(projectBudgetCents: number | null) {
    const project = await repository.createProject({
      name: `Budget project ${crypto.randomUUID()}`,
      objective: "Check the campaign spend ceiling.",
      context: "", scope: "", constraints: [], budgetCents: projectBudgetCents
    });
    return createCollectionCampaign({
      projectId: project.id,
      name: "Budgeted campaign",
      entitySchema: [{ name: "name", description: "Entity name" }],
      documentTemplate: "# {{name}}",
      dedupeKeys: ["name"]
    });
  }

  it("uses the default ceiling when the project has no budget", async () => {
    const campaign = await budgetCampaign(null);

    const budget = await getCollectionBudget(campaign.id, {
      getRunCostMicros: async () => 0,
      getProjectBudgetCents: async () => null
    });

    expect(budget).toMatchObject({
      ceilingCents: CAMPAIGN_DEFAULT_CEILING_CENTS,
      spentCents: 0,
      exhausted: false
    });
  });

  it("tightens the ceiling to the project's budget when that is lower", async () => {
    const campaign = await budgetCampaign(50);

    const budget = await getCollectionBudget(campaign.id, {
      getRunCostMicros: async () => 0,
      getProjectBudgetCents: async () => 50
    });

    expect(budget.ceilingCents).toBe(50);
  });

  it("does not let a project budget raise the ceiling above the campaign default", async () => {
    const campaign = await budgetCampaign(100_000);

    const budget = await getCollectionBudget(campaign.id, {
      getRunCostMicros: async () => 0,
      getProjectBudgetCents: async () => 100_000
    });

    expect(budget.ceilingCents).toBe(CAMPAIGN_DEFAULT_CEILING_CENTS);
  });

  it("rounds fractional spend up, so cheap calls still move the ceiling", async () => {
    const campaign = await budgetCampaign(null);

    // 1_000 micros is a tenth of a cent - it must not read as zero spend.
    const budget = await getCollectionBudget(campaign.id, {
      getRunCostMicros: async () => 1_000,
      getProjectBudgetCents: async () => null
    });

    expect(budget.spentCents).toBe(1);
  });

  it("reports exhausted once spend reaches the ceiling", async () => {
    const campaign = await budgetCampaign(null);

    const budget = await getCollectionBudget(campaign.id, {
      getRunCostMicros: async () => CAMPAIGN_DEFAULT_CEILING_CENTS * 10_000,
      getProjectBudgetCents: async () => null
    });

    expect(budget).toMatchObject({ exhausted: true, remainingCents: 0 });
  });

  it("reports exhausted at the project's tighter ceiling, not only the default", async () => {
    const campaign = await budgetCampaign(20);

    // 30 cents of spend is well under the 500-cent default but over the project's 20.
    const budget = await getCollectionBudget(campaign.id, {
      getRunCostMicros: async () => 300_000,
      getProjectBudgetCents: async () => 20
    });

    expect(budget).toMatchObject({ ceilingCents: 20, spentCents: 30, exhausted: true });
  });
});
