import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { organizationProfileInput, updateOrganizationProfileDraft } from "@/lib/organization-profile";

export const PATCH = guard<{ profileId: string }>(async (request, { session, params }) => {
  const parsed = await parseJson(request, organizationProfileInput);
  if (parsed.error) return parsed.error;
  const profile = await updateOrganizationProfileDraft(
    session.organizationId,
    params.profileId,
    organizationProfileInput.parse(parsed.data)
  );
  return profile
    ? NextResponse.json({ data: profile })
    : NextResponse.json({ error: "draft_not_found" }, { status: 404 });
}, { admin: true });
