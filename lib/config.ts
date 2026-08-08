/**
 * One place that says what this app needs in order to run.
 *
 * Before this existed, a missing variable surfaced wherever it happened to be
 * read first - `callWorkflowApp` throwing mid-campaign, `requestModel` quietly
 * bypassing cost tracking, `secret()` throwing inside a login attempt. The
 * failure was always far from the cause, and in the worst case it was not a
 * failure at all but a silent downgrade.
 *
 * The rule here: a variable that changes whether the app is *correct* is
 * required in production and reported at boot. A variable that only enables an
 * optional capability is optional, and its absence is a documented degradation
 * rather than an error.
 */

export type ConfigRequirement = {
  key: string;
  reason: string;
  /** Extra validation beyond "is present", for values whose shape matters. */
  validate?: (value: string) => string | null;
};

/**
 * Required in production. Each entry names the consequence of its absence,
 * because "DATABASE_URL is not set" is less useful than knowing the app will
 * silently serve an in-memory store that empties on restart.
 */
export const requiredInProduction: ConfigRequirement[] = [
  {
    key: "DATABASE_URL",
    reason: "Without it every module falls back to an in-process store that empties on restart."
  },
  {
    key: "AUTH_SESSION_SECRET",
    reason: "Session cookies cannot be signed or verified.",
    validate: (value) => value.length >= 32
      ? null
      : "must contain at least 32 characters"
  },
  {
    key: "REDIS_URL",
    reason: "Rate limiting has no shared store, so limits stop being enforced across instances."
  },
  {
    key: "LITELLM_BASE_URL",
    reason: "Every model call routes through LiteLLM; agents cannot run without it."
  },
  {
    key: "LITELLM_API_KEY",
    reason: "Every model call routes through LiteLLM; agents cannot run without it."
  },
  {
    key: "BUSINESS_OS_INTERNAL_URL",
    reason: "Background tasks cannot call back into the app, so every campaign fails on its first callback."
  },
  {
    key: "WORKFLOW_CALLBACK_SECRET",
    reason: "Background callbacks cannot authenticate, and model calls bypass cost tracking and budget enforcement."
  },
  {
    key: "RAILWAY_BUCKET_ENDPOINT",
    reason: "Report exports, document uploads, and attachments have nowhere to be stored."
  },
  {
    key: "RAILWAY_BUCKET_NAME",
    reason: "Report exports, document uploads, and attachments have nowhere to be stored."
  },
  {
    key: "RAILWAY_BUCKET_ACCESS_KEY_ID",
    reason: "Object storage cannot authenticate."
  },
  {
    key: "RAILWAY_BUCKET_SECRET_ACCESS_KEY",
    reason: "Object storage cannot authenticate."
  }
];

/**
 * Optional, but their absence changes behaviour in a way worth stating rather
 * than discovering. These are reported at boot as notices, not errors.
 */
export const optionalWithConsequence: ConfigRequirement[] = [
  {
    key: "TRIGGER_SECRET_KEY",
    reason: "Campaigns and agent runs cannot execute in the background; dispatch reports local mode instead."
  },
  {
    key: "MCP_SERVICE_SECRET",
    reason: "Governed tool calls are unauthenticated against the MCP service."
  },
  {
    key: "TAVILY_API_KEY",
    reason: "No general web search provider, so research falls back to reference sources only."
  },
  {
    key: "LITELLM_EMBEDDING_ROUTE",
    reason: "Context retrieval and campaign query dedupe degrade to lexical matching."
  },
  {
    key: "GMAIL_TOKEN_ENCRYPTION_KEY",
    reason: "Gmail integration cannot store tokens and stays unavailable."
  },
  {
    key: "DOCUMENT_CONVERSION_SERVICE_URL",
    reason: "Advanced PDF/DOCX export is unavailable; supported text, Markdown, and simple DOCX imports still work locally."
  },
  {
    key: "ORGANIZATION_BUDGET_CENTS",
    reason: "No organization-wide spend ceiling; only per-project and per-campaign limits apply."
  }
];

export type ConfigReport = {
  ok: boolean;
  errors: string[];
  notices: string[];
};

function evaluate(requirement: ConfigRequirement, value: string | undefined) {
  if (!value || value.trim().length === 0) return "is not set";
  return requirement.validate?.(value) ?? null;
}

/**
 * Builds the report without throwing, so a caller can decide whether an
 * incomplete configuration is fatal. `inspectConfig` is used by the health
 * endpoint (which should answer, not crash) and by `assertConfig` (which
 * should refuse to start).
 */
export function inspectConfig(
  environment: NodeJS.ProcessEnv = process.env
): ConfigReport {
  const production = environment.NODE_ENV === "production";
  const errors: string[] = [];
  const notices: string[] = [];

  for (const requirement of requiredInProduction) {
    const problem = evaluate(requirement, environment[requirement.key]);
    if (!problem) continue;
    const message = `${requirement.key} ${problem}. ${requirement.reason}`;
    // Outside production the same gap is a notice: local development runs
    // deliberately without most of this, and turning that into a hard failure
    // would make the app impossible to start on a laptop.
    if (production) errors.push(message);
    else notices.push(message);
  }

  for (const requirement of optionalWithConsequence) {
    const problem = evaluate(requirement, environment[requirement.key]);
    if (problem) notices.push(`${requirement.key} ${problem}. ${requirement.reason}`);
  }

  return { ok: errors.length === 0, errors, notices };
}

/**
 * Refuses to continue when production configuration is incomplete.
 *
 * Deliberately fatal rather than degraded. A half-configured production
 * instance is the state that produces the most confusing failures: it accepts
 * traffic, appears to work, and loses data or silently skips enforcement. A
 * process that will not start is a problem someone fixes in minutes.
 */
export function assertConfig(environment: NodeJS.ProcessEnv = process.env) {
  const report = inspectConfig(environment);
  if (report.ok) return report;
  throw new Error(
    [
      "Refusing to start: required configuration is missing or invalid.",
      ...report.errors.map((error) => `  - ${error}`),
      "",
      "Set these and restart. See .env.example for the full list."
    ].join("\n")
  );
}
