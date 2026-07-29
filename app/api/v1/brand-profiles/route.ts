import { NextResponse } from "next/server";
import { z } from "zod";
import { createBrandProfile } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(200),
  audience: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  positioning: z.string().max(10000).default(""),
  voice: z.record(z.string(), z.unknown()).default({}),
  approvedClaims: z.array(z.string().trim().min(1).max(1000)).max(500).default([]),
  prohibitedClaims: z.array(z.string().trim().min(1).max(1000)).max(500).default([]),
  competitors: z.array(z.string().trim().min(1).max(300)).max(500).default([])
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await createBrandProfile(parsed.data) }, { status: 201 });
}
