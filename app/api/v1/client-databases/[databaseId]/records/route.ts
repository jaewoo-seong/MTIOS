import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ databaseId: string }>(async (_request, { params }) => {
  const { databaseId } = params;
  const databases = await repository.listClientDatabases();
  if (!databases.some((database) => database.id === databaseId)) return notFound("client database");
  return NextResponse.json({ data: await repository.listRecords(databaseId) });
});

export const POST = guard<{ databaseId: string }>(async (request, { params }) => {
  void request;
  void params;
  return NextResponse.json({
    error: "Direct client-record writes are disabled. Create and approve a client change set."
  }, { status: 405 });
});
