import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  page: z.string().trim().min(1).max(60),
  projectId: z.string().uuid().nullable().default(null),
  instruction: z.string().trim().min(2).max(12000),
  context: z.object({
    page: z.string().trim().min(1).max(60),
    projectId: z.string().uuid().nullable().optional(),
    documentId: z.string().uuid().nullable().optional(),
    knowledgeEntryId: z.string().uuid().nullable().optional(),
    clientDatabaseId: z.string().uuid().nullable().optional(),
    selectedRecordIds: z.array(z.string().uuid()).max(500).optional()
  }).optional()
});

/**
 * `expensive` because a command is the head of every agent run. Creating one is
 * cheap; what it authorizes is not, and a client retrying in a loop would queue
 * paid work rather than merely reading.
 */
export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const command = await repository.createCommand({
    page: parsed.data.page,
    projectId: parsed.data.projectId ?? null,
    instruction: parsed.data.instruction,
    context: parsed.data.context ?? {
      page: parsed.data.page,
      projectId: parsed.data.projectId ?? null
    }
  }, session.userId);
  return NextResponse.json({ data: command }, { status: 201 });
}, { rateLimit: "expensive" });
