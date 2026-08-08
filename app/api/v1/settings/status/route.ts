import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { checkLiteLLM, modelRoutes } from "@/lib/ai/litellm";
import { gatewayModelCatalog, modelRoutePolicies, resolveGatewayModel } from "@/lib/ai/model-policy";
import { sql } from "@/lib/db/client";
import { pingRedis } from "@/lib/redis";
import { configuredCredentials } from "@/lib/research/engine";
import { researchProviderCatalog } from "@/lib/research/providers";
import { checkStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * One place the Settings page can ask "is everything configured, and which
 * model is actually serving each route" — previously spread across
 * /api/health (no auth, no models), /api/v1/settings/models (no providers),
 * and nothing at all for search providers.
 *
 * Reports the *resolved* model per route, read from the same env var LiteLLM
 * reads, so the page cannot show a model that is not the one being invoked.
 * Credentials are reported as configured/missing only — never their values.
 */
type State = "ok" | "configured" | "not_configured" | "unavailable";

async function attempt(check: () => Promise<State>): Promise<State> {
  try {
    return await check();
  } catch {
    return "unavailable";
  }
}

export const GET = guard(async () => {
  const [database, redis, storage, litellm, conversion] = await Promise.all([
    attempt(async () => {
      if (!sql) return "not_configured";
      await sql`select 1`;
      return "ok";
    }),
    attempt(async () => (await pingRedis()) as State),
    attempt(async () => (await checkStorage()) as State),
    attempt(async () => (await checkLiteLLM()) as State),
    attempt(async () => {
      const base = process.env.DOCUMENT_CONVERSION_SERVICE_URL;
      if (!base) return "not_configured";
      const response = await fetch(`${base.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(3000)
      });
      return response.ok ? "ok" : "unavailable";
    })
  ]);

  const services = [
    { key: "database", name: "PostgreSQL", state: database, detail: "Business state and accounting" },
    { key: "litellm", name: "LiteLLM gateway", state: litellm, detail: "Every model call routes through this" },
    { key: "redis", name: "Redis", state: redis, detail: "Cache and rate limiting" },
    { key: "storage", name: "Object storage", state: storage, detail: "Reports, exports, attachments" },
    { key: "document_conversion", name: "Document conversion", state: conversion, detail: "Upload conversion and OCR" },
    {
      key: "mcp",
      name: "MCP tools",
      state: (process.env.MCP_SERVICE_URL && process.env.MCP_SERVICE_SECRET
        ? "configured" : "not_configured") as State,
      detail: "Governed tool adapters"
    },
    {
      key: "trigger",
      name: "Trigger.dev",
      state: (process.env.TRIGGER_SECRET_KEY && process.env.TRIGGER_PROJECT_REF
        ? "configured" : "not_configured") as State,
      detail: "Background agent workflows"
    }
  ];

  // Only providers that need a key are worth surfacing — the rest are always
  // available and would pad the list with rows nobody has to act on.
  const providers = researchProviderCatalog
    .filter((provider) => provider.requiresCredential)
    .map((provider) => {
      const keys = [provider.credentialEnv, ...(provider.fallbackCredentialEnvs ?? [])]
        .filter((name): name is string => Boolean(name));
      const present = configuredCredentials(provider);
      return {
        key: provider.key,
        name: provider.name,
        categories: provider.category,
        state: (present.length > 0 ? "configured" : "not_configured") as State,
        keys: keys.map((name) => ({ name, present: present.includes(name) })),
        role: typeof provider.policy.role === "string" ? provider.policy.role : null
      };
    });

  const models = modelRoutes.map((route) => {
    const policy = modelRoutePolicies[route];
    const candidate = policy.candidates[0];
    const modelEnv = candidate?.modelEnv ?? null;
    const resolved = gatewayModelCatalog.find((item) => item.gatewayModel === resolveGatewayModel(candidate?.gatewayModel ?? ""))?.model
      ?? (modelEnv ? process.env[modelEnv] ?? null : null);
    return {
      route,
      purpose: policy.purpose,
      modelEnv,
      // null means the variable is unset on this service: the route is either
      // unserved or the Settings display is out of step with LiteLLM.
      model: resolved,
      pricingClass: candidate?.pricingClass ?? null,
      licensingStatus: candidate?.licensingStatus ?? null,
      maxCostMicros: policy.maxCostMicros,
      structuredOutput: policy.structuredOutput
    };
  });

  return NextResponse.json({
    data: {
      services,
      providers,
      models,
      environment: process.env.NODE_ENV ?? "development",
      testingMode: process.env.ALLOW_TESTING_MODELS === "true"
    }
  });
}, { admin: true });
