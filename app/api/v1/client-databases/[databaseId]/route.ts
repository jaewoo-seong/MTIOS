import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ databaseId: string }> }) {
  const { databaseId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const database = await repository.updateClientDatabase(databaseId, parsed.data);
  if (!database) return notFound("client database");
  return NextResponse.json({ data: database });
}
