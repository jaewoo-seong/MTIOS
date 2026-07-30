import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(60)
});

export const GET = guard(async () => {
  return NextResponse.json({ data: await repository.listFolders() });
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, createFolderSchema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await repository.createFolder(parsed.data.name) }, { status: 201 });
});
