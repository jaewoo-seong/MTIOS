import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { searchWorkspace } from "@/lib/search";

export const dynamic = "force-dynamic";

export const GET = guard(async (request) => {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ data: await searchWorkspace(query), query });
});
