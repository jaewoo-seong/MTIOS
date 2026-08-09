export const evidenceCapabilities = [
  "legal_identity",
  "financial_filings",
  "business_status",
  "government_registration",
  "official_website",
  "recent_news",
  "hiring",
  "patents",
  "market_context"
] as const;

export type EvidenceCapability = typeof evidenceCapabilities[number];

export const defaultDossierEvidenceCapabilities: EvidenceCapability[] = [
  "legal_identity",
  "financial_filings",
  "business_status",
  "government_registration",
  "official_website",
  "recent_news"
];

export const evidenceCapabilityLabels: Record<EvidenceCapability, string> = {
  legal_identity: "Legal identity",
  financial_filings: "Financial filings",
  business_status: "Business status",
  government_registration: "Government registration",
  official_website: "Official website",
  recent_news: "Recent news",
  hiring: "Hiring and workforce",
  patents: "Patents and trademarks",
  market_context: "Market context"
};
