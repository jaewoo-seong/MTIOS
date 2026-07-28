import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({ instruction: z.string().trim().min(2).max(12000) });

export async function POST(request: Request, { params }: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const command = await repository.updateCommand(commandId, {
    instruction: parsed.data.instruction,
    status: "awaiting_confirmation",
    clarification: "Confirm the revised instruction before execution."
  });
  if (!command) return notFound("command");
  return NextResponse.json({ data: command });
}
