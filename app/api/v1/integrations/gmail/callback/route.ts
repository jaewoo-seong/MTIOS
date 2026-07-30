import { NextResponse } from "next/server";
import { completeGmailAuthorization } from "@/lib/gmail";

import { guard } from "@/lib/api/guard";
export const GET = guard(async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(new URL(`/?integration=gmail&status=${encodeURIComponent(oauthError)}`, request.url));
  }
  if (!code || !state) {
    return NextResponse.json({ error: "Missing OAuth code or state." }, { status: 400 });
  }
  try {
    await completeGmailAuthorization({ code, state });
    return NextResponse.redirect(new URL("/?integration=gmail&status=connected", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail connection failed.";
    return NextResponse.redirect(new URL(`/?integration=gmail&status=error&detail=${encodeURIComponent(message)}`, request.url));
  }
});
