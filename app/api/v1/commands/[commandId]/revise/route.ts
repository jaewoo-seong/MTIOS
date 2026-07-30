import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  instruction: z.string().trim().min(2).max(12000),
  clarificationAnswer: z.string().trim().min(1).max(4000).optional()
});

export const POST = guard<{ commandId: string }>(async (request, { params }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const command = await repository.reviseCommand(
    params.commandId,
    parsed.data.instruction,
    parsed.data.clarificationAnswer
  );
  if (!command) return notFound("command");
  return NextResponse.json({ data: command });
});
