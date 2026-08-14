import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { approveOrganizationProfileDraft } from "@/lib/organization-profile";

export const POST = guard<{ profileId: string }>(async (_request, { session, params }) => {
  const profile = await approveOrganizationProfileDraft(session.organizationId, params.profileId, session.userId);
  return profile
    ? NextResponse.json({ data: profile })
    : NextResponse.json({ error: "draft_not_found" }, { status: 404 });
}, { admin: true, rateLimit: "auth" });
