import { NextResponse } from "next/server";
import { z } from "zod";
import { setBrandProfileStatus } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({ status: z.enum(["draft", "approved", "retired"]) });

export const POST = guard<{ profileId: string }>(async (request, { params }) => {
  const { profileId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const profile = await setBrandProfileStatus(profileId, parsed.data.status);
  return profile
    ? NextResponse.json({ data: profile })
    : NextResponse.json({ error: "Brand profile not found." }, { status: 404 });
});
