import { NextResponse } from "next/server";
import { z } from "zod";
import { createClientChangeSet } from "@/lib/client-changes";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const itemSchema = z.object({
  operation: z.enum(["insert", "update", "delete", "merge"]),
  recordId: z.string().uuid().nullable().optional(),
  mergeRecordId: z.string().uuid().nullable().optional(),
  after: z.record(z.string(), z.string()).nullable().optional(),
  sourceEvidenceIds: z.array(z.string().uuid()).max(100).default([]),
  confidence: z.number().int().min(0).max(100).default(0),
  validationWarnings: z.array(z.string().max(1000)).max(100).default([]),
  duplicateRecordIds: z.array(z.string().uuid()).max(100).default([])
});
const schema = z.object({
  projectId: z.string().uuid(),
  agendaId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  databaseId: z.string().uuid(),
  title: z.string().trim().min(2).max(300),
  reason: z.string().max(5000).default(""),
  idempotencyKey: z.string().trim().min(8).max(200),
  expiresInSeconds: z.number().int().min(300).max(604800).default(86400),
  items: z.array(itemSchema).min(1).max(1000)
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({
      data: await createClientChangeSet(parsed.data)
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Change set could not be created."
    }, { status: 400 });
  }
});
