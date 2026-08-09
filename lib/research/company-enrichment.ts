import JSZip from "jszip";
import {
  availableProviderAccounts,
  recordProviderAccountUsage,
  updateProviderAccountHealth,
  type ProviderAccountRef
} from "@/lib/research/accounts";
import {
  defaultDossierEvidenceCapabilities,
  type EvidenceCapability
} from "@/lib/research/evidence-capabilities";

type Fetcher = typeof fetch;

export type OfficialCompanyEvidence = {
  provider: string;
  sourceRole: string;
  status: "available" | "unavailable" | "not_applicable" | "error";
  sourceUrl: string;
  retrievedAt: string;
  data?: unknown;
  message?: string;
};

type EnrichmentInput = {
  projectId: string;
  runId: string;
  candidateId: string;
  company: Record<string, unknown>;
  evidenceCapabilities?: EvidenceCapability[];
};

let dartDirectoryCache: { expiresAt: number; companies: Map<string, string[]> } | null = null;

export function inferCompanyCountry(company: Record<string, unknown>) {
  const explicit = firstValue(company, ["countryCode", "country_code", "country"])?.toUpperCase();
  if (explicit === "KR" || explicit === "KOR" || explicit?.includes("KOREA") || explicit?.includes("한국")) return "KR";
  if (explicit === "US" || explicit === "USA" || explicit?.includes("UNITED STATES")) return "US";
  const location = firstValue(company, ["location", "headquarters", "address"])?.toUpperCase() ?? "";
  if (/한국|KOREA|SEOUL|BUSAN|INCHEON|DAEGU|DAEJEON|ULSAN|GYEONGGI|JEJU/.test(location)) return "KR";
  if (/UNITED STATES|\bUSA\b|\bU\.S\./.test(location)) return "US";
  return "GLOBAL";
}

export function companyResearchName(company: Record<string, unknown>) {
  return firstValue(company, ["legalName", "legal_name", "name", "companyName", "company_name"]) ?? "";
}

export function businessRegistrationNumber(company: Record<string, unknown>) {
  const raw = firstValue(company, [
    "businessRegistrationNumber", "business_registration_number", "businessNumber", "business_number", "b_no"
  ]);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

/**
 * Bounded, country-aware official enrichment. It intentionally performs no
 * broad discovery: global identity is checked once, then at most two local
 * registry calls are added for Korea or the U.S.
 */
export async function researchOfficialCompanyData(
  input: EnrichmentInput,
  options: { fetcher?: Fetcher; now?: () => Date } = {}
) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const name = companyResearchName(input.company);
  if (!name) return [];
  const country = inferCompanyCountry(input.company);
  const capabilities = new Set(input.evidenceCapabilities?.length
    ? input.evidenceCapabilities
    : defaultDossierEvidenceCapabilities);
  const evidence: OfficialCompanyEvidence[] = [];

  if (capabilities.has("legal_identity")) evidence.push(await researchGleif(name, fetcher, now));
  if (country === "KR") {
    if (capabilities.has("financial_filings")) evidence.push(await researchOpenDart(name, input, fetcher, now));
    const registrationNumber = businessRegistrationNumber(input.company);
    if (registrationNumber && capabilities.has("business_status")) {
      evidence.push(await researchKoreanBusinessStatus(registrationNumber, input, fetcher, now));
    }
  } else if (country === "US") {
    if (capabilities.has("financial_filings")) evidence.push(await researchSec(name, fetcher, now));
    if (capabilities.has("government_registration")) evidence.push(await researchSamGov(name, input, fetcher, now));
  }
  return evidence.filter((item) => item.status !== "not_applicable");
}

async function researchGleif(name: string, fetcher: Fetcher, now: () => Date): Promise<OfficialCompanyEvidence> {
  const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=5`;
  return publicJsonEvidence("gleif", "global_legal_identity", url, fetcher, now, (raw) => {
    const data = asRecord(raw).data;
    return Array.isArray(data) ? data.slice(0, 5) : [];
  });
}

async function researchSec(name: string, fetcher: Fetcher, now: () => Date): Promise<OfficialCompanyEvidence> {
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(name)}&from=0&size=10`;
  return publicJsonEvidence("sec_edgar", "us_filings", url, fetcher, now, (raw) => {
    const hits = asRecord(asRecord(raw).hits).hits;
    return Array.isArray(hits) ? hits.slice(0, 10) : [];
  });
}

async function researchOpenDart(
  name: string,
  input: EnrichmentInput,
  fetcher: Fetcher,
  now: () => Date
): Promise<OfficialCompanyEvidence> {
  const provider = "opendart";
  const sourceUrl = "https://opendart.fss.or.kr/";
  const accounts = await availableProviderAccounts(provider, ["OPENDART_API_KEY"]);
  if (accounts.length === 0) return unavailable(provider, "korean_filings", sourceUrl, now, "OpenDART key is not configured.");
  const account = accounts[0];
  try {
    const key = process.env[account.credentialEnv] ?? "";
    const directory = await loadDartDirectory(key, account, input, fetcher);
    const codes = directory.get(normalizeName(name)) ?? [];
    if (codes.length === 0) return available(provider, "korean_filings", sourceUrl, now, { matches: [] });
    const corpCode = codes[0];
    const profileUrl = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${corpCode}`;
    const beginning = new Date(now().getTime() - 366 * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
    const filingsUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${corpCode}&bgn_de=${beginning}&page_count=10`;
    const [profile, filings] = await Promise.all([
      managedJson(profileUrl, account, input, "company_profile", fetcher),
      managedJson(filingsUrl, account, input, "recent_filings", fetcher)
    ]);
    return available(provider, "korean_filings", sourceUrl, now, {
      corpCode,
      profile,
      recentFilings: Array.isArray(asRecord(filings).list) ? (asRecord(filings).list as unknown[]).slice(0, 10) : []
    });
  } catch (error) {
    return failed(provider, "korean_filings", sourceUrl, now, error);
  }
}

async function researchKoreanBusinessStatus(
  registrationNumber: string,
  input: EnrichmentInput,
  fetcher: Fetcher,
  now: () => Date
): Promise<OfficialCompanyEvidence> {
  const provider = "korean_public_data";
  const sourceUrl = "https://www.data.go.kr/data/15081808/openapi.do";
  const accounts = await availableProviderAccounts(provider, ["KOREAN_PUBLIC_DATA_SERVICE_KEY"]);
  if (accounts.length === 0) return unavailable(provider, "business_status", sourceUrl, now, "Korean Public Data key is not configured.");
  const account = accounts[0];
  try {
    const key = process.env[account.credentialEnv] ?? "";
    const url = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(key)}`;
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ b_no: [registrationNumber] }),
      signal: AbortSignal.timeout(15000)
    });
    await recordCall(account, input, "business_status", response.ok, response.ok ? undefined : `HTTP ${response.status}`);
    if (!response.ok) throw new Error(`Korean business-status API returned HTTP ${response.status}.`);
    const raw = await response.json();
    const rows = asRecord(raw).data;
    return available(provider, "business_status", sourceUrl, now, Array.isArray(rows) ? rows.slice(0, 1) : []);
  } catch (error) {
    return failed(provider, "business_status", sourceUrl, now, error);
  }
}

async function researchSamGov(
  name: string,
  input: EnrichmentInput,
  fetcher: Fetcher,
  now: () => Date
): Promise<OfficialCompanyEvidence> {
  const provider = "sam_gov";
  const sourceUrl = "https://sam.gov/";
  const accounts = await availableProviderAccounts(provider, ["SAM_GOV_API_KEY"]);
  if (accounts.length === 0) return unavailable(provider, "us_government_registration", sourceUrl, now, "SAM.gov key is not configured.");
  const account = accounts[0];
  try {
    const key = process.env[account.credentialEnv] ?? "";
    const url = `https://api.sam.gov/entity-information/v4/entities?api_key=${encodeURIComponent(key)}&legalBusinessName=${encodeURIComponent(name)}&includeSections=entityRegistration,coreData`;
    const raw = await managedJson(url, account, input, "entity_lookup", fetcher);
    const data = asRecord(raw).entityData;
    return available(provider, "us_government_registration", sourceUrl, now, Array.isArray(data) ? data.slice(0, 5) : []);
  } catch (error) {
    return failed(provider, "us_government_registration", sourceUrl, now, error);
  }
}

async function loadDartDirectory(
  key: string,
  account: ProviderAccountRef,
  input: EnrichmentInput,
  fetcher: Fetcher
) {
  if (dartDirectoryCache && dartDirectoryCache.expiresAt > Date.now()) return dartDirectoryCache.companies;
  const response = await fetcher(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`, {
    headers: { accept: "application/zip" }, signal: AbortSignal.timeout(30000)
  });
  await recordCall(account, input, "corporation_directory", response.ok, response.ok ? undefined : `HTTP ${response.status}`);
  if (!response.ok) throw new Error(`OpenDART corporation directory returned HTTP ${response.status}.`);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const file = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".xml"));
  if (!file) throw new Error("OpenDART corporation directory did not contain XML.");
  const xml = await file.async("string");
  const companies = new Map<string, string[]>();
  for (const match of xml.matchAll(/<list>[\s\S]*?<corp_code>([^<]+)<\/corp_code>[\s\S]*?<corp_name>([^<]+)<\/corp_name>[\s\S]*?<\/list>/g)) {
    const code = match[1].trim();
    const normalized = normalizeName(decodeXml(match[2]));
    companies.set(normalized, [...(companies.get(normalized) ?? []), code]);
  }
  dartDirectoryCache = { expiresAt: Date.now() + 86_400_000, companies };
  return companies;
}

async function managedJson(
  url: string,
  account: ProviderAccountRef,
  input: EnrichmentInput,
  operation: string,
  fetcher: Fetcher
) {
  const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  await recordCall(account, input, operation, response.ok, response.ok ? undefined : `HTTP ${response.status}`);
  if (!response.ok) throw new Error(`${account.provider} returned HTTP ${response.status}.`);
  return response.json();
}

async function recordCall(
  account: ProviderAccountRef,
  input: EnrichmentInput,
  operation: string,
  success: boolean,
  error?: string
) {
  await recordProviderAccountUsage({
    account, projectId: input.projectId, runId: input.runId, candidateId: input.candidateId,
    operation, status: success ? "completed" : "failed"
  });
  await updateProviderAccountHealth(account, success ? { success: true } : { error: error ?? "Provider call failed." });
}

async function publicJsonEvidence(
  provider: string,
  sourceRole: string,
  url: string,
  fetcher: Fetcher,
  now: () => Date,
  select: (raw: unknown) => unknown
): Promise<OfficialCompanyEvidence> {
  try {
    const response = await fetcher(url, {
      headers: {
        accept: "application/json",
        "user-agent": process.env.RESEARCH_USER_AGENT ?? "MTI-Business-OS/1.0 (contact: operator@mti.local)"
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}.`);
    return available(provider, sourceRole, url.split("?")[0], now, select(await response.json()));
  } catch (error) {
    return failed(provider, sourceRole, url.split("?")[0], now, error);
  }
}

function firstValue(company: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = company[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeName(value: string) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/주식회사|㈜|\(주\)/g, "")
    .replace(/[\s.,'"()_-]+/g, "");
}

function decodeXml(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function available(provider: string, sourceRole: string, sourceUrl: string, now: () => Date, data: unknown): OfficialCompanyEvidence {
  return { provider, sourceRole, sourceUrl, status: "available", retrievedAt: now().toISOString(), data };
}

function unavailable(provider: string, sourceRole: string, sourceUrl: string, now: () => Date, message: string): OfficialCompanyEvidence {
  return { provider, sourceRole, sourceUrl, status: "unavailable", retrievedAt: now().toISOString(), message };
}

function failed(provider: string, sourceRole: string, sourceUrl: string, now: () => Date, error: unknown): OfficialCompanyEvidence {
  return {
    provider, sourceRole, sourceUrl, status: "error", retrievedAt: now().toISOString(),
    message: error instanceof Error ? error.message : "Provider request failed."
  };
}
