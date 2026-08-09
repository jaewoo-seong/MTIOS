import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { updateResearchSettings } from "@/lib/research-workspace";

const schema = z.object({
  dossierWorkerLimit: z.number().int().min(1).max(10).optional(),
  revisionWorkerLimit: z.number().int().min(1).max(5).optional(),
  queueBufferTarget: z.number().int().min(1).max(100).optional(),
  queueBufferAutomatic: z.boolean().optional(),
  discoveryEnabled: z.boolean().optional(),
  researchPaused: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, "At least one setting is required.");

export const PATCH = guard<{ projectId: string }>(async (request, { params }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await updateResearchSettings(params.projectId, parsed.data) });
});
