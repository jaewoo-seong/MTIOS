import { describe, expect, it } from "vitest";
import {
  addBrainstormingIdea,
  addMarketingConcept,
  addContentCalendarItem,
  addMarketingVariant,
  completeBrainstormingSession,
  createBrainstormingSession,
  createBrandProfile,
  createMarketingCampaign,
  createMarketingExperiment,
  createCreativeOutput,
  decideBrainstormingIdea,
  decideMarketingConcept,
  proposeExternalMarketingAction,
  setBrandProfileStatus,
  setMarketingCampaignApproval
} from "@/lib/creative-work";
import { buildContextPack } from "@/lib/context/retrieval";
import { repository } from "@/lib/repository";

async function project() {
  return repository.createProject({
    name: "Creative workflow verification",
    objective: "Preserve creative decisions and approved brand context.",
    context: "",
    scope: "",
    constraints: [],
    budgetCents: 1000
  });
}

describe("marketing workflow", () => {
  it("retrieves approved brand and campaign facts but excludes drafts", async () => {
    const current = await project();
    const brand = await createBrandProfile({
      projectId: current.id,
      name: "Approved context verification",
      positioning: "Distinctive verification position NOVACLAIMTOKEN",
      approvedClaims: ["NOVACLAIMTOKEN is approved."],
      prohibitedClaims: ["Never claim unsupported outcomes."]
    });
    const before = await buildContextPack({
      projectId: current.id,
      query: "NOVACLAIMTOKEN"
    });
    expect(before.citations.some((item) => item.sourceType === "brand_profile")).toBe(false);

    await setBrandProfileStatus(brand.id, "approved");
    const campaign = await createMarketingCampaign({
      projectId: current.id,
      brandProfileId: brand.id,
      name: "Durable campaign",
      objective: "Use CAMPAIGNCONTEXTTOKEN with approved claims.",
      channels: ["email"],
      assumptions: ["Audience requires technical evidence."]
    });
    await setMarketingCampaignApproval(campaign.id, "approved", "planned");

    const brandPack = await buildContextPack({
      projectId: current.id,
      query: "NOVACLAIMTOKEN"
    });
    expect(brandPack.citations.some((item) => item.sourceType === "brand_profile")).toBe(true);
    const campaignPack = await buildContextPack({
      projectId: current.id,
      query: "CAMPAIGNCONTEXTTOKEN"
    });
    expect(campaignPack.citations.some((item) => item.sourceType === "marketing_campaign")).toBe(true);

    const concept = await addMarketingConcept(campaign.id, {
      title: "Evidence-led concept",
      rationale: "Matches approved positioning."
    });
    const rejected = await decideMarketingConcept(
      concept.id,
      "rejected",
      "Too similar to an existing campaign."
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      decisionReason: "Too similar to an existing campaign."
    });
    const variant = await addMarketingVariant(concept.id, {
      name: "Email variant",
      channel: "email",
      format: "newsletter",
      content: "Working copy"
    });
    expect(variant).toMatchObject({ status: "draft", channel: "email" });
    const calendar = await addContentCalendarItem(campaign.id, {
      variantId: variant.id,
      title: "Reviewed email",
      channel: "email"
    });
    expect(calendar).toMatchObject({ status: "planned", channel: "email" });
    const output = await createCreativeOutput({
      projectId: current.id,
      title: "Campaign decision memo",
      outputType: "decision_memo",
      summary: "Editable campaign decision record."
    });
    expect(output).toMatchObject({
      editable: true,
      report: { status: "working" }
    });
  });

  it("creates review-required external actions without executing them", async () => {
    const current = await project();
    const proposal = await proposeExternalMarketingAction({
      projectId: current.id,
      actionType: "publish",
      payload: { destination: "website", contentId: crypto.randomUUID() },
      reason: "Publication requires operator review."
    });
    expect(proposal).toMatchObject({
      actionType: "publish",
      status: "review_required",
      executedAt: null
    });
    expect(proposal.reviewId).toBeTruthy();
  });
});

describe("brainstorming workflow", () => {
  it("retains alternatives, scores, rejected reasons, decisions, and experiments", async () => {
    const current = await project();
    const session = await createBrainstormingSession({
      projectId: current.id,
      prompt: "Generate practical channel experiments.",
      evaluationCriteria: ["evidence", "cost", "speed"],
      assumptions: ["No external activation before approval."]
    });
    const idea = await addBrainstormingIdea(session.id, {
      title: "Partner briefing",
      description: "Test a structured briefing.",
      scores: { evidence: 80, cost: 70, speed: 90 }
    });
    const decided = await decideBrainstormingIdea(
      idea.id,
      "rejected",
      "Audience access is not established."
    );
    expect(decided).toMatchObject({
      status: "rejected",
      decisionReason: "Audience access is not established."
    });
    const completed = await completeBrainstormingSession(
      session.id,
      "Retain rejected alternatives; test direct outreach first."
    );
    expect(completed).toMatchObject({
      status: "completed",
      decisionSummary: "Retain rejected alternatives; test direct outreach first."
    });
    const experiment = await createMarketingExperiment({
      projectId: current.id,
      sessionId: session.id,
      hypothesis: "Direct outreach produces qualified conversations.",
      method: "Prepare a reviewed sample and measure replies.",
      metrics: ["qualified_reply_rate"]
    });
    expect(experiment).toMatchObject({ status: "planned" });
  });
});
