import { describe, expect, it } from "vitest";
import { organizationProfileContext, organizationProfileInput } from "@/lib/organization-profile";

describe("organization profile", () => {
  it("validates bounded official context", () => {
    const profile = organizationProfileInput.parse({
      companyName: "MTI",
      description: "International business services.",
      services: ["Market-entry research"],
      sourceUrls: ["https://example.com/about"]
    });
    expect(profile.services).toEqual(["Market-entry research"]);
    expect(profile.forbiddenClaims).toEqual([]);
    expect(() => organizationProfileInput.parse({ ...profile, sourceUrls: ["not-a-url"] })).toThrow();
  });

  it("formats only bounded approved-profile sections for MCP", () => {
    const now = new Date();
    const context = organizationProfileContext({
      id: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      revision: 1,
      status: "approved",
      ...organizationProfileInput.parse({
        companyName: "MTI",
        description: "Company description",
        services: ["Research", "Advisory"],
        forbiddenClaims: ["Guaranteed outcomes"]
      }),
      createdBy: null,
      approvedBy: null,
      approvedAt: now,
      createdAt: now,
      updatedAt: now
    });
    expect(context).toContainEqual({ title: "Services", content: "- Research\n- Advisory" });
    expect(context).toContainEqual({ title: "Forbidden claims", content: "- Guaranteed outcomes" });
    expect(context.length).toBeLessThanOrEqual(10);
  });
});
