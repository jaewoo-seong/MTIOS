import { NextResponse } from "next/server";
import { getContextPack } from "@/lib/context/retrieval";
import { notFound } from "@/lib/http";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ packId: string }>(async (_request, { params }) => {
  const { packId } = params;
  const pack = await getContextPack(packId);
  if (!pack) return notFound("context_pack");
  return NextResponse.json({ data: pack });
});
