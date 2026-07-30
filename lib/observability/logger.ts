/**
 * Structured logging, deliberately dependency-free.
 *
 * The question this exists to answer is operational rather than aesthetic:
 * "why did this campaign cost forty dollars", "which provider failed", "which
 * run stalled and where". None of that is answerable from `console.log` strings
 * scattered through request handlers, because you cannot filter or aggregate
 * prose. One JSON object per line is greppable, and every log platform ingests
 * it without configuration.
 *
 * No Sentry or OpenTelemetry SDK here on purpose. Adding a vendor agent is a
 * decision with cost and data-residency implications that belongs to whoever
 * runs this, not to the code. `reportError` is the seam they hook into: point
 * it at a provider and every existing call site starts reporting.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Values safe to put in a log line. Deliberately narrow - passing an arbitrary
 * object invites logging a whole request body, or a token that happened to be
 * on it.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  // Tests are noisy enough without info-level chatter from every helper they
  // exercise; production wants the full picture.
  if (process.env.NODE_ENV === "test") return "error";
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * Keys whose values are never logged, matched case-insensitively as substrings.
 *
 * A denylist rather than an allowlist because callers add fields over time and
 * the failure mode of a missed allowlist entry (a useful field silently
 * dropped) is much less costly than the failure mode of a missed denylist entry
 * would be if this were reversed.
 */
const REDACTED = ["password", "secret", "token", "apikey", "api_key", "authorization", "cookie"];

function redact(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    safe[key] = REDACTED.some((needle) => key.toLowerCase().includes(needle))
      ? "[redacted]"
      : value;
  }
  return safe;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...redact(fields)
  });
  // stderr for warn and above so a log pipeline can split streams without
  // parsing; stdout for the rest.
  if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields)
};

/**
 * The single seam for error reporting.
 *
 * Every unexpected failure should pass through here rather than calling a
 * vendor SDK directly, so that adopting or replacing one is a change to this
 * function instead of a change to every call site. Today it logs; wiring a
 * provider means adding one call below.
 */
export function reportError(event: string, error: unknown, fields: LogFields = {}) {
  logger.error(event, {
    ...fields,
    message: error instanceof Error ? error.message : String(error),
    // Truncated because a stack is useful for orientation, and a full one on
    // every error crowds out the surrounding lines that give it context.
    stack: error instanceof Error ? error.stack?.split("\n").slice(0, 4).join(" | ") : undefined
  });
}

/**
 * Records what one model call actually cost, so spend can be attributed after
 * the fact rather than reconstructed.
 *
 * Separate from `logger.info` because these lines are the ones an operator
 * aggregates over - a fixed field set makes "sum cost by route for this run" a
 * one-line query instead of a parsing exercise.
 */
export function logModelCall(fields: {
  runId: string | null;
  route: string;
  model: string | null;
  provider: string | null;
  costMicros: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  fallbackReason?: string | null;
  error?: string | null;
}) {
  logger.info("model.call", {
    runId: fields.runId,
    route: fields.route,
    model: fields.model,
    provider: fields.provider,
    costMicros: fields.costMicros,
    latencyMs: fields.latencyMs,
    inputTokens: fields.inputTokens,
    outputTokens: fields.outputTokens,
    fallbackReason: fields.fallbackReason ?? null,
    error: fields.error ?? null
  });
}

/**
 * Records external research spend, which is tracked in a different ledger from
 * model spend and was invisible to campaign budgets until recently. Logging it
 * alongside model calls is what makes total campaign cost reconstructable from
 * logs alone.
 */
export function logResearchQuery(fields: {
  runId: string | null;
  provider: string;
  costCents: number;
  resultCount: number;
  cacheState: "hit" | "miss" | "reused";
  status: string;
}) {
  logger.info("research.query", { ...fields });
}
