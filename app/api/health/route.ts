import { NextResponse } from "next/server";
import { checkLiteLLM } from "@/lib/ai/litellm";
import { inspectConfig } from "@/lib/config";
import { sql } from "@/lib/db/client";
import { pingRedis } from "@/lib/redis";
import { checkStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    database: "not_configured",
    redis: "not_configured",
    storage: "not_configured",
    litellm: "not_configured",
    documentConversion: "not_configured",
    authentication: "not_configured"
  };
  let status = 200;
  if (sql) {
    try {
      await sql`select 1`;
      checks.database = "ok";
    } catch {
      checks.database = "unavailable";
      status = 503;
    }
  } else if (process.env.NODE_ENV === "production") {
    checks.database = "unavailable";
    status = 503;
  }
  try {
    checks.redis = await pingRedis();
  } catch {
    checks.redis = "unavailable";
    status = 503;
  }
  try {
    checks.storage = await checkStorage();
  } catch {
    checks.storage = "unavailable";
    status = 503;
  }
  if (process.env.NODE_ENV === "production" &&
      (checks.redis === "not_configured" || checks.storage === "not_configured")) {
    status = 503;
  }
  try {
    checks.litellm = await checkLiteLLM();
  } catch {
    checks.litellm = "unavailable";
    status = 503;
  }
  if (process.env.NODE_ENV === "production" && checks.litellm === "not_configured") {
    status = 503;
  }
  if (process.env.DOCUMENT_CONVERSION_SERVICE_URL) {
    try {
      const response = await fetch(
        `${process.env.DOCUMENT_CONVERSION_SERVICE_URL.replace(/\/$/, "")}/health`,
        { signal: AbortSignal.timeout(3000) }
      );
      checks.documentConversion = response.ok ? "ok" : "unavailable";
    } catch {
      checks.documentConversion = "unavailable";
    }
  }
  // Optional while imports are limited to text, Markdown, and simple DOCX.
  // The private converter remains useful for advanced export work, but an
  // outage must not take the supported import workflow offline.
  checks.authentication = (process.env.AUTH_SESSION_SECRET?.length ?? 0) >= 32
    ? "ok"
    : "not_configured";
  if (process.env.NODE_ENV === "production" && checks.authentication !== "ok") {
    status = 503;
  }
  // The reachability checks above answer "is the dependency up". This answers
  // "is this instance configured to do its job", which is a different question
  // and the one that explains a silently degraded feature - lexical-only
  // retrieval, unbudgeted model calls, campaigns that cannot dispatch.
  const config = inspectConfig();
  if (!config.ok) status = 503;
  return NextResponse.json({
    status: status === 200 ? "ok" : "degraded",
    service: "business-os",
    checks,
    configuration: {
      ok: config.ok,
      errors: config.errors,
      degradations: config.notices
    },
    time: new Date().toISOString()
  }, { status });
}
