import { NextResponse } from "next/server";
import { z } from "zod";
import { createBrainstormingSession } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  projectId: z.string().uuid(),
  agendaId: z.string().uuid().nullable().optional(),
  prompt: z.string().trim().min(2).max(10000),
  evaluationCriteria: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  assumptions: z.array(z.string().trim().min(1).max(2000)).max(200).default([])
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await createBrainstormingSession(parsed.data)
  }, { status: 201 });
});
