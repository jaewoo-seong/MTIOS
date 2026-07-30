import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).optional()
});

export const PATCH = guard<{ databaseId: string }>(async (request, { params }) => {
  const { databaseId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const database = await repository.updateClientDatabase(databaseId, parsed.data);
  if (!database) return notFound("client database");
  return NextResponse.json({ data: database });
});

export const DELETE = guard<{ databaseId: string }>(async (_request, { params }) => {
  const { databaseId } = params;
  const deleted = await repository.deleteClientDatabase(databaseId);
  if (!deleted) return notFound("client database");
  return new NextResponse(null, { status: 204 });
});
