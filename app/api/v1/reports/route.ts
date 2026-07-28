import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  projectId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(2).max(180),
  summary: z.string().max(4000).default(""),
  content: z.string().max(100000).default("")
});

export async function GET() {
  return NextResponse.json({ data: await repository.listReports() });
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createReport({
      projectId: parsed.data.projectId ?? null,
      title: parsed.data.title,
      summary: parsed.data.summary ?? "",
      content: parsed.data.content ?? ""
    })
  }, { status: 201 });
}
