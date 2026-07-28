import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default("")
});

export async function GET() {
  return NextResponse.json({ data: await repository.listClientDatabases() });
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createClientDatabase({
      name: parsed.data.name,
      description: parsed.data.description ?? ""
    })
  }, { status: 201 });
}
