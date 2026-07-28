import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  collection: z.string().trim().min(2).max(100),
  title: z.string().trim().min(2).max(180),
  content: z.string().trim().min(2).max(30000),
  source: z.string().trim().max(1000).nullable().default(null)
});

export async function GET() {
  return NextResponse.json({ data: await repository.listKnowledge() });
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createKnowledge({
      collection: parsed.data.collection,
      title: parsed.data.title,
      content: parsed.data.content,
      source: parsed.data.source ?? null
    })
  }, { status: 201 });
}
