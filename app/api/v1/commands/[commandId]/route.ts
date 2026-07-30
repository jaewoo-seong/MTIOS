import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

export const GET = guard<{ commandId: string }>(async (_request, { params }) => {
  const command = await repository.getCommand(params.commandId);
  if (!command) return notFound("command");
  return NextResponse.json({ data: command });
});
