import { NextResponse } from "next/server";
import { getContextPack } from "@/lib/context/retrieval";
import { notFound } from "@/lib/http";

export async function GET(_: Request, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const pack = await getContextPack(packId);
  if (!pack) return notFound("context_pack");
  return NextResponse.json({ data: pack });
}
