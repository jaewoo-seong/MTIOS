import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  summary: z.string().max(4000).optional(),
  content: z.string().max(100000).optional(),
  status: z.enum(["working", "review", "saved"]).optional()
});

export const PATCH = guard<{ reportId: string }>(async (request, { params }) => {
  const { reportId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const report = await repository.updateReport(reportId, parsed.data);
  if (!report) return notFound("report");
  return NextResponse.json({ data: report });
});
