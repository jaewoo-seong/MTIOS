import { NextResponse } from "next/server";
import { completeGmailAuthorization } from "@/lib/gmail";
import { getAppUrl } from "@/lib/app-url";

import { guard } from "@/lib/api/guard";
export const GET = guard(async (request) => {
  const url = new URL(request.url);
  const redirectUrl = getAppUrl(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    redirectUrl.searchParams.set("integration", "gmail");
    redirectUrl.searchParams.set("status", oauthError);
    return NextResponse.redirect(redirectUrl);
  }
  if (!code || !state) {
    return NextResponse.json({ error: "Missing OAuth code or state." }, { status: 400 });
  }
  try {
    await completeGmailAuthorization({ code, state });
    redirectUrl.searchParams.set("integration", "gmail");
    redirectUrl.searchParams.set("status", "connected");
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail connection failed.";
    redirectUrl.searchParams.set("integration", "gmail");
    redirectUrl.searchParams.set("status", "error");
    redirectUrl.searchParams.set("detail", message);
    return NextResponse.redirect(redirectUrl);
  }
}, { admin: true });
