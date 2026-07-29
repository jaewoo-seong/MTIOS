import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

export async function GET(_: Request, { params }: { params: Promise<{ databaseId: string }> }) {
  const { databaseId } = await params;
  const databases = await repository.listClientDatabases();
  if (!databases.some((database) => database.id === databaseId)) return notFound("client database");
  return NextResponse.json({ data: await repository.listRecords(databaseId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ databaseId: string }> }) {
  void request;
  void await params;
  return NextResponse.json({
    error: "Direct client-record writes are disabled. Create and approve a client change set."
  }, { status: 405 });
}
