import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  instruction: z.string().trim().min(2).max(12000),
  clarificationAnswer: z.string().trim().min(1).max(4000).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const command = await repository.reviseCommand(
    commandId,
    parsed.data.instruction,
    parsed.data.clarificationAnswer
  );
  if (!command) return notFound("command");
  return NextResponse.json({ data: command });
}
