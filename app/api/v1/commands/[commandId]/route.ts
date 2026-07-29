import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

export async function GET(_: Request, { params }: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await params;
  const command = await repository.getCommand(commandId);
  if (!command) return notFound("command");
  return NextResponse.json({ data: command });
}
