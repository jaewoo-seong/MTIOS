import { NextResponse } from "next/server";
import { checkLiteLLM } from "@/lib/ai/litellm";
import { sql } from "@/lib/db/client";
import { pingRedis } from "@/lib/redis";
import { checkStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    database: "not_configured",
    redis: "not_configured",
    storage: "not_configured"
    ,
    litellm: "not_configured"
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
  return NextResponse.json({
    status: status === 200 ? "ok" : "degraded",
    service: "business-os",
    checks,
    time: new Date().toISOString()
  }, { status });
}
