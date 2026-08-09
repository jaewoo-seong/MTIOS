import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { researchProviderCatalog } from "@/lib/research/providers";
import {
  credentialedResearchProviderKeys,
  credentialedResearchProviderLabels,
  providerAccountLimits,
  suggestedCredentialEnvs,
  suggestedProviderQuotas
} from "@/lib/research/provider-keys";

/**
 * Provider accounts registered in settings are resolved by provider key at
 * request time. A key that matches neither the research catalog nor a direct
 * availableProviderAccounts() call is silently ignored: the account looks
 * connected in the UI and is never used.
 */
function directLookupKeys() {
  const sources = [
    "lib/research/company-enrichment.ts",
    "lib/research/official-site.ts"
  ].map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");
  const keys = new Set<string>();
  for (const match of sources.matchAll(/availableProviderAccounts\(\s*"([a-z_]+)"/g)) keys.add(match[1]);
  for (const match of sources.matchAll(/const provider = "([a-z_]+)"/g)) keys.add(match[1]);
  return keys;
}

describe("research provider account keys", () => {
  it("resolves every registrable provider to a real consumer", () => {
    const catalogKeys = new Set(researchProviderCatalog.map((provider) => provider.key));
    const lookupKeys = directLookupKeys();
    const orphaned = credentialedResearchProviderKeys.filter(
      (key) => !catalogKeys.has(key) && !lookupKeys.has(key)
    );
    expect(orphaned).toEqual([]);
  });

  it("keeps us_census aligned with the research catalog key", () => {
    expect(credentialedResearchProviderKeys).toContain("us_census");
    expect(credentialedResearchProviderKeys).not.toContain("census");
    expect(researchProviderCatalog.some((provider) => provider.key === "us_census")).toBe(true);
  });

  it("describes every registrable provider in the settings UI", () => {
    for (const key of credentialedResearchProviderKeys) {
      expect(credentialedResearchProviderLabels[key], key).toBeTruthy();
      expect(suggestedCredentialEnvs[key], key).toMatch(/^[A-Z][A-Z0-9_]{2,99}$/);
      expect(providerAccountLimits[key], key).toBeGreaterThan(0);
      expect(suggestedProviderQuotas[key], key).toBeDefined();
    }
  });
});
