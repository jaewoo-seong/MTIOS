import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

export async function DELETE(_: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const deleted = await repository.deleteRecord(recordId);
  if (!deleted) return notFound("record");
  return new NextResponse(null, { status: 204 });
}
