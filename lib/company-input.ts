import { z } from "zod";

export const companyInputSchema = z.object({
  legalName: z.string().trim().min(1).max(300),
  tradingNames: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  domain: z.string().trim().max(500).nullable().optional(),
  countryCode: z.string().trim().min(2).max(3).nullable().optional(),
  locations: z.array(z.record(z.string(), z.string())).max(100).default([]),
  classifications: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  identifiers: z.array(z.object({
    type: z.string().trim().min(1).max(60),
    value: z.string().trim().min(1).max(200),
    issuingCountry: z.string().trim().min(2).max(3).nullable().optional()
  })).max(100).default([]),
  confidence: z.number().int().min(0).max(100).default(0),
  completeness: z.number().int().min(0).max(100).default(0),
  source: z.object({
    url: z.string().url().max(2000),
    type: z.string().trim().min(1).max(60).optional(),
    title: z.string().trim().max(500).optional(),
    evidence: z.record(z.string(), z.unknown()).optional()
  }).optional()
});
