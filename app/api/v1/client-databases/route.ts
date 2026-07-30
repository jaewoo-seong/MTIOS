import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default("")
});

export const GET = guard(async () => {
  return NextResponse.json({ data: await repository.listClientDatabases() });
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createClientDatabase({
      name: parsed.data.name,
      description: parsed.data.description ?? ""
    })
  }, { status: 201 });
});
