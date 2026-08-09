export const credentialedResearchProviderKeys = [
  "tavily",
  "firecrawl",
  "opendart",
  "korean_public_data",
  "sam_gov",
  // Must match the provider catalog key exactly. The research engine looks
  // accounts up by catalog key, so a mismatch silently orphans every account
  // registered here.
  "us_census",
  "fred",
  "kosis"
] as const;

export type CredentialedResearchProviderKey = typeof credentialedResearchProviderKeys[number];

export const credentialedResearchProviderLabels: Record<CredentialedResearchProviderKey, string> = {
  tavily: "Tavily — web discovery",
  firecrawl: "Firecrawl — official websites",
  opendart: "OpenDART — Korean filings",
  korean_public_data: "Korean Public Data — business and procurement",
  sam_gov: "SAM.gov — U.S. registered entities",
  us_census: "U.S. Census — market statistics",
  fred: "FRED — U.S. economic context",
  kosis: "KOSIS — Korean market statistics"
};

export const suggestedCredentialEnvs: Record<CredentialedResearchProviderKey, string> = {
  tavily: "TAVILY_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  opendart: "OPENDART_API_KEY",
  korean_public_data: "KOREAN_PUBLIC_DATA_SERVICE_KEY",
  sam_gov: "SAM_GOV_API_KEY",
  us_census: "CENSUS_API_KEY",
  fred: "FRED_API_KEY",
  kosis: "KOSIS_API_KEY"
};

export const providerAccountLimits: Record<CredentialedResearchProviderKey, number> = {
  tavily: 3,
  firecrawl: 3,
  opendart: 1,
  korean_public_data: 1,
  sam_gov: 1,
  us_census: 1,
  fred: 1,
  kosis: 1
};

const credentialEnvSlots: Partial<Record<CredentialedResearchProviderKey, string[]>> = {
  tavily: ["TAVILY_API_KEY", "TAVILY_API_KEY_BACKUP", "TAVILY_API_KEY_3"],
  firecrawl: ["FIRECRAWL_API_KEY", "FIRECRAWL_API_KEY_2", "FIRECRAWL_API_KEY_3"]
};

export function suggestedCredentialEnvForSlot(provider: CredentialedResearchProviderKey, slot: number) {
  return credentialEnvSlots[provider]?.[slot] ?? suggestedCredentialEnvs[provider];
}

export const suggestedProviderQuotas: Record<CredentialedResearchProviderKey, {
  allowance: number | null;
  quotaPeriod: "daily" | "monthly";
}> = {
  tavily: { allowance: 1000, quotaPeriod: "monthly" },
  firecrawl: { allowance: null, quotaPeriod: "monthly" },
  opendart: { allowance: null, quotaPeriod: "daily" },
  korean_public_data: { allowance: null, quotaPeriod: "daily" },
  sam_gov: { allowance: 10, quotaPeriod: "daily" },
  us_census: { allowance: null, quotaPeriod: "daily" },
  fred: { allowance: null, quotaPeriod: "daily" },
  kosis: { allowance: null, quotaPeriod: "daily" }
};
