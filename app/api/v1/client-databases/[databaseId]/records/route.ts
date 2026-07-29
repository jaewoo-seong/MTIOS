import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const createRecordsSchema = z.object({
  records: z.array(z.record(z.string(), z.string())).min(1).max(5000)
});

export async function GET(_: Request, { params }: { params: Promise<{ databaseId: string }> }) {
  const { databaseId } = await params;
  const databases = await repository.listClientDatabases();
  if (!databases.some((database) => database.id === databaseId)) return notFound("client database");
  return NextResponse.json({ data: await repository.listRecords(databaseId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ databaseId: string }> }) {
  const { databaseId } = await params;
  const databases = await repository.listClientDatabases();
  if (!databases.some((database) => database.id === databaseId)) return notFound("client database");

  const parsed = await parseJson(request, createRecordsSchema);
  if (parsed.error) return parsed.error;

  const created = await repository.createRecords(databaseId, parsed.data.records);
  return NextResponse.json({ data: created, count: created.length }, { status: 201 });
}
