import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";

export async function GET() {
  return NextResponse.json({ data: await repository.listAgentDefinitions() });
}
