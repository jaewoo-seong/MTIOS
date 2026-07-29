import { NextResponse } from "next/server";
import { searchWorkspace } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json({ data: await searchWorkspace(query), query });
}
