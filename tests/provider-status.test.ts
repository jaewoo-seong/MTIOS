import { afterEach, describe, expect, it, vi } from "vitest";
import { checkProviderKeys, credentialState } from "@/lib/research/provider-status";

afterEach(() => { delete process.env.TAVILY_API_KEY_3; vi.unstubAllGlobals(); });

describe("research provider status", () => {
  it("distinguishes examples from configured secrets", () => {
    expect(credentialState(undefined)).toBe("missing");
    expect(credentialState("YOUR_API_KEY")).toBe("example");
    expect(credentialState("tvly-real-looking-value")).toBe("configured");
  });

  it("validates Tavily and reports remaining credits", async () => {
    process.env.TAVILY_API_KEY_3 = `tvly-${crypto.randomUUID()}`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      key: { usage: 12, limit: 1000 }, account: { current_plan: "Researcher", plan_usage: 12, plan_limit: 1000 }
    }), { status: 200 })));
    const [result] = await checkProviderKeys("tavily", ["TAVILY_API_KEY_3"]);
    expect(result).toMatchObject({ state: "ok", usage: { used: 12, limit: 1000, remaining: 988 } });
  });
});
