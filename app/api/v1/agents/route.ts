import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { repository } from "@/lib/repository";

export const GET = guard(async () => {
  return NextResponse.json({ data: await repository.listAgentDefinitions() });
});
