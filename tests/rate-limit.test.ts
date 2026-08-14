import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
  status: "ready",
  connect: vi.fn(),
  eval: vi.fn()
}));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { consumeRateLimit, rateLimitHeaders, rateLimitTiers } from "@/lib/rate-limit";

describe("rate limiting", () => {
  beforeEach(() => redisMock.eval.mockReset());

  it("allows calls within the fixed window and returns remaining capacity", async () => {
    redisMock.eval.mockResolvedValue([12, 40]);
    const result = await consumeRateLimit("external-mcp-credential:test", "standard");
    expect(result).toMatchObject({ allowed: true, remaining: rateLimitTiers.standard.limit - 12, degraded: false });
    expect(redisMock.eval).toHaveBeenCalledWith(expect.any(String), 1, "ratelimit:standard:external-mcp-credential:test", "60");
  });

  it("denies calls beyond the tier limit and supplies backoff headers", async () => {
    redisMock.eval.mockResolvedValue([rateLimitTiers.expensive.limit + 1, 117]);
    const result = await consumeRateLimit("external-mcp-write:test", "expensive");
    expect(result).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 117, degraded: false });
    expect(rateLimitHeaders(result)).toMatchObject({ "RateLimit-Limit": "20", "RateLimit-Remaining": "0", "Retry-After": "117" });
  });
});
