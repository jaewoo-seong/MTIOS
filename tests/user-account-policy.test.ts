import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeLoginIdentifier } from "@/lib/auth";
import { normalizeEmailAddress } from "@/lib/admin-users";
import { publicRoute } from "@/lib/api/guard";

describe("email account policy", () => {
  it("normalizes login identifiers and stored emails consistently", () => {
    expect(normalizeLoginIdentifier("  Person@Example.COM  ")).toBe("person@example.com");
    expect(normalizeEmailAddress("  Person@Example.COM  ")).toBe("person@example.com");
  });

  it("can explicitly provide an unlimited public endpoint", async () => {
    const route = publicRoute(async () => Response.json({ ok: true }), { rateLimit: false });
    for (let attempt = 0; attempt < 350; attempt += 1) {
      const response = await route(new Request("https://example.test/login", { method: "POST" }), {
        params: Promise.resolve({})
      });
      expect(response.status).toBe(200);
      expect(response.headers.has("RateLimit-Limit")).toBe(false);
    }
  });

  it("keeps login unlimited and removes account-lock behavior", () => {
    const auth = readFileSync("lib/auth.ts", "utf8");
    const loginRoute = readFileSync("app/api/v1/auth/login/route.ts", "utf8");
    const userSettings = readFileSync("components/account-settings.tsx", "utf8");
    const adminUsers = readFileSync("lib/admin-users.ts", "utf8");

    expect(loginRoute).toContain("{ rateLimit: false }");
    expect(auth).not.toContain("LOCK_ATTEMPTS");
    expect(auth).not.toContain("lockedUntil");
    expect(auth).not.toContain("failedLoginAttempts");
    expect(userSettings).not.toContain("Unlock");
    expect(adminUsers).not.toContain("account_unlocked");
  });

  it("requires email, a non-empty initial password, and organization scoping", () => {
    const createRoute = readFileSync("app/api/v1/admin/users/route.ts", "utf8");
    const resetRoute = readFileSync("app/api/v1/admin/users/[userId]/reset-password/route.ts", "utf8");
    const adminUsers = readFileSync("lib/admin-users.ts", "utf8");

    expect(createRoute).toContain("email: z.string().trim().email().max(254)");
    expect(createRoute).toContain("password: z.string().min(1)");
    expect(resetRoute).toContain("password: z.string().min(1)");
    expect(createRoute).toContain("organizationId: session.organizationId");
    expect(adminUsers).toContain("eq(memberships.organizationId, input.organizationId)");
    expect(adminUsers).toContain("An account with this email already exists.");
    expect(adminUsers).toContain("pg_advisory_xact_lock");
  });
});
