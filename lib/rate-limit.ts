import { redis } from "@/lib/redis";
import { logger } from "@/lib/observability/logger";

/**
 * Fixed-window rate limiting on top of the Redis this app already runs.
 *
 * Account lockout (five failed attempts, `lib/auth.ts`) protects one account
 * from being guessed. It does nothing about the shape of attack that matters
 * more here: one client trying one password against many usernames, which never
 * trips any individual account's counter. That is what per-IP limiting is for,
 * and it did not exist.
 *
 * The second purpose is cost. A handful of endpoints each dispatch real spend -
 * a campaign fans out a hundred paid workers, a research query buys provider
 * credits. Those deserve a ceiling per user that is unrelated to authentication.
 *
 * Fixed window rather than sliding: a sliding window needs either a sorted set
 * per key or a Lua script over timestamps, and the extra precision buys nothing
 * at these limits. The known tradeoff is burstiness at a window boundary - up to
 * two windows' worth of requests can land back to back - which is acceptable
 * when the limits exist to stop sustained abuse rather than to shape traffic.
 */

export type RateLimitTier = "auth" | "expensive" | "standard";

export type RateLimitRule = { limit: number; windowSeconds: number; reason: string };

export const rateLimitTiers: Record<RateLimitTier, RateLimitRule> = {
  /**
   * Keyed by IP, not by account, precisely so that spreading attempts across
   * usernames does not evade it. Ten per minute is far above what a person
   * typing a password needs and far below what guessing requires.
   */
  auth: { limit: 10, windowSeconds: 60, reason: "Too many authentication attempts." },
  /**
   * Endpoints that dispatch model or provider spend. Twenty per five minutes is
   * generous for a human operator and still bounds a runaway script or a stuck
   * retry loop in the UI.
   */
  expensive: { limit: 20, windowSeconds: 300, reason: "Too many costly operations in a short period." },
  /**
   * A backstop for ordinary reads and writes. High enough that normal use never
   * meets it, low enough that a broken client polling in a tight loop does.
   */
  standard: { limit: 300, windowSeconds: 60, reason: "Too many requests." }
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  /** True when the limit could not be evaluated, so the request was let through. */
  degraded: boolean;
};

/**
 * INCR and EXPIRE as one atomic step.
 *
 * Doing it as two commands leaves a real gap: a crash between them, or an
 * EXPIRE that fails, leaves a counter with no TTL, and that key then blocks its
 * subject permanently. Setting the expiry only on first increment keeps the
 * window fixed rather than sliding forward on every request.
 */
const WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {current, redis.call('TTL', KEYS[1])}
`;

/**
 * Checks and consumes one unit of a subject's allowance.
 *
 * Fails open. If Redis is unreachable this returns `allowed` with
 * `degraded: true` rather than rejecting, because a cache outage should not
 * become an authentication outage - and for the login path specifically, account
 * lockout still applies from Postgres, so the most important protection is
 * unaffected. The degradation is logged at warn precisely so that "we were
 * unprotected for twenty minutes" is discoverable afterwards rather than silent.
 */
export async function consumeRateLimit(
  subject: string,
  tier: RateLimitTier = "standard"
): Promise<RateLimitResult> {
  const rule = rateLimitTiers[tier];
  const base: RateLimitResult = {
    allowed: true,
    limit: rule.limit,
    remaining: rule.limit - 1,
    retryAfterSeconds: 0,
    degraded: false
  };
  if (!redis) {
    // Absent Redis is a configuration state, not an incident. `lib/config.ts`
    // reports it at boot and the health endpoint reports it continuously, so
    // logging it per request would only bury the lines that matter.
    return { ...base, degraded: true };
  }
  const key = `ratelimit:${tier}:${subject}`;
  try {
    if (redis.status === "wait") await redis.connect();
    const [count, ttl] = await redis.eval(
      WINDOW_SCRIPT,
      1,
      key,
      String(rule.windowSeconds)
    ) as [number, number];
    const retryAfterSeconds = ttl > 0 ? ttl : rule.windowSeconds;
    if (count > rule.limit) {
      return {
        allowed: false,
        limit: rule.limit,
        remaining: 0,
        retryAfterSeconds,
        degraded: false
      };
    }
    return {
      allowed: true,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: 0,
      degraded: false
    };
  } catch (error) {
    logger.warn("ratelimit.unavailable", {
      tier,
      message: error instanceof Error ? error.message : "redis eval failed"
    });
    return { ...base, degraded: true };
  }
}

/**
 * The IP to hold responsible for a request.
 *
 * Reads the leftmost `x-forwarded-for` entry, which is the client as recorded by
 * the first proxy. That value is only trustworthy because this app is always
 * deployed behind a proxy that sets it; exposed directly, a client could forge
 * it and evade the limit. Falls back to a shared bucket rather than to "no
 * limit", so a request with no discernible origin is still bounded.
 */
export function requestSubject(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown-origin";
}

/** Standard advisory headers, so a client can back off instead of retrying blindly. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining)
  };
  if (!result.allowed) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}
