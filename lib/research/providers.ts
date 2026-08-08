export type ResearchCategory =
  | "web"
  | "company"
  | "government"
  | "economic"
  | "korean"
  | "academic"
  | "reference";

export type ResearchProviderDefinition = {
  key: string;
  name: string;
  category: ResearchCategory[];
  baseUrl: string;
  credentialEnv: string | null;
  /**
   * Additional keys for the SAME provider, tried in order after
   * `credentialEnv` is exhausted or rate-limited. Distinct from provider
   * fallback: a spare key keeps the chosen provider serving instead of
   * handing the query to a different service with different coverage.
   */
  fallbackCredentialEnvs?: string[];
  requiresCredential: boolean;
  priority: number;
  requestsPerSecond: number;
  concurrency: number;
  dailyQueryLimit: number | null;
  cacheTtlSeconds: number;
  policyUrl: string;
  policy: Record<string, unknown>;
  qualityScore: number;
  costCents: number;
};

export const researchProviderCatalog: ResearchProviderDefinition[] = [
  {
    key: "tavily",
    name: "Tavily",
    category: ["web", "company"],
    baseUrl: "https://api.tavily.com/search",
    credentialEnv: "TAVILY_API_KEY",
    fallbackCredentialEnvs: ["TAVILY_API_KEY_BACKUP", "TAVILY_API_KEY_3"],
    requiresCredential: true,
    priority: 10,
    requestsPerSecond: 2,
    concurrency: 2,
    dailyQueryLimit: null,
    cacheTtlSeconds: 86400,
    policyUrl: "https://docs.tavily.com/documentation/api-credits",
    policy: { role: "primary broad web search", fallback: "brave" },
    qualityScore: 70,
    costCents: 1
  },
  // Brave was removed deliberately. Tavily is the only general web-search
  // provider: two Tavily keys (see fallbackCredentialEnvs above) give
  // redundancy within one service whose result shape and coverage the
  // normalizer already handles, rather than silently switching to a provider
  // with different ranking and different licensing.
  {
    key: "sec_edgar",
    name: "SEC EDGAR",
    category: ["company", "government"],
    baseUrl: "https://efts.sec.gov/LATEST/search-index",
    credentialEnv: null,
    requiresCredential: false,
    priority: 10,
    requestsPerSecond: 8,
    concurrency: 2,
    dailyQueryLimit: null,
    cacheTtlSeconds: 86400,
    policyUrl: "https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits",
    policy: {
      maximumRequestsPerSecond: 10,
      requireIdentifiedUserAgent: true,
      configuredBelowPublishedMaximum: true
    },
    qualityScore: 98,
    costCents: 0
  },
  {
    key: "us_census",
    name: "U.S. Census",
    category: ["company", "government", "economic"],
    baseUrl: "https://api.census.gov/data",
    credentialEnv: "CENSUS_API_KEY",
    requiresCredential: false,
    priority: 20,
    requestsPerSecond: 2,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://www.census.gov/data/developers/about/terms-of-service.html",
    policy: { optionalCredential: true },
    qualityScore: 96,
    costCents: 0
  },
  {
    key: "world_bank",
    name: "World Bank",
    category: ["government", "economic"],
    baseUrl: "https://api.worldbank.org/v2",
    credentialEnv: null,
    requiresCredential: false,
    priority: 10,
    requestsPerSecond: 2,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
    policy: { authenticationRequired: false, apiVersion: 2 },
    qualityScore: 96,
    costCents: 0
  },
  {
    key: "fred",
    name: "FRED",
    category: ["economic", "government"],
    baseUrl: "https://api.stlouisfed.org/fred",
    credentialEnv: "FRED_API_KEY",
    requiresCredential: true,
    priority: 20,
    requestsPerSecond: 2,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
    policy: { attributionRequired: true },
    qualityScore: 96,
    costCents: 0
  },
  {
    key: "korean_public_data",
    name: "Korean Public Data Portal",
    category: ["korean", "government", "company"],
    baseUrl: "https://apis.data.go.kr",
    credentialEnv: "KOREAN_PUBLIC_DATA_SERVICE_KEY",
    requiresCredential: true,
    priority: 10,
    requestsPerSecond: 1,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 86400,
    policyUrl: "https://www.data.go.kr/en/ugs/selectPublicDataUseGuideView.do",
    policy: { endpointMustBeSelectedByDataset: true },
    qualityScore: 96,
    costCents: 0
  },
  {
    key: "kosis",
    name: "KOSIS",
    category: ["korean", "government", "economic"],
    baseUrl: "https://kosis.kr/openapi",
    credentialEnv: "KOSIS_API_KEY",
    requiresCredential: true,
    priority: 20,
    requestsPerSecond: 1,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://kosis.kr/openapi/",
    policy: { koreanStatistics: true },
    qualityScore: 97,
    costCents: 0
  },
  {
    key: "openalex",
    name: "OpenAlex",
    category: ["academic"],
    baseUrl: "https://api.openalex.org",
    credentialEnv: "OPENALEX_API_KEY",
    requiresCredential: false,
    priority: 10,
    requestsPerSecond: 10,
    concurrency: 3,
    dailyQueryLimit: 10000,
    cacheTtlSeconds: 604800,
    policyUrl: "https://developers.openalex.org/api-reference/introduction",
    policy: { creditMetered: true, optionalCredential: true },
    qualityScore: 88,
    costCents: 0
  },
  {
    key: "crossref",
    name: "Crossref",
    category: ["academic"],
    baseUrl: "https://api.crossref.org",
    credentialEnv: null,
    requiresCredential: false,
    priority: 20,
    requestsPerSecond: 3,
    concurrency: 3,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/",
    policy: {
      politePool: true,
      contactRequiredForPolitePool: true,
      respectAdvertisedRateHeaders: true
    },
    qualityScore: 88,
    costCents: 0
  },
  {
    key: "semantic_scholar",
    name: "Semantic Scholar",
    category: ["academic"],
    baseUrl: "https://api.semanticscholar.org/graph/v1",
    credentialEnv: "SEMANTIC_SCHOLAR_API_KEY",
    requiresCredential: false,
    priority: 30,
    requestsPerSecond: 1,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://www.semanticscholar.org/product/api",
    policy: { optionalCredential: true, credentialImprovesLimits: true },
    qualityScore: 84,
    costCents: 0
  },
  {
    key: "wikimedia",
    // Reference only. It used to also claim "web", which made it the silent
    // fallback for general web search — returning encyclopedia articles when
    // Tavily failed, which reads as thin results rather than as an outage.
    name: "Wikimedia",
    category: ["reference"],
    baseUrl: "https://en.wikipedia.org/w/api.php",
    credentialEnv: null,
    requiresCredential: false,
    priority: 50,
    requestsPerSecond: 3,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits",
    policy: {
      identifiedRequestsPerMinute: 200,
      maximumConcurrency: 3,
      requireUserAgent: true,
      respectRetryAfter: true,
      serialPreferred: true
    },
    qualityScore: 68,
    costCents: 0
  },
  {
    key: "wikidata",
    name: "Wikidata",
    category: ["reference", "company"],
    baseUrl: "https://www.wikidata.org/w/api.php",
    credentialEnv: null,
    requiresCredential: false,
    priority: 40,
    requestsPerSecond: 3,
    concurrency: 1,
    dailyQueryLimit: null,
    cacheTtlSeconds: 604800,
    policyUrl: "https://www.mediawiki.org/wiki/API:Etiquette",
    policy: { requireUserAgent: true, respectRetryAfter: true, serialPreferred: true },
    qualityScore: 75,
    costCents: 0
  }
];

export function providersFor(category: ResearchCategory) {
  return researchProviderCatalog
    .filter((provider) => provider.category.includes(category))
    .sort((left, right) => left.priority - right.priority);
}
