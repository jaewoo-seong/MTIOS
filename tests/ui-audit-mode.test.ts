import { afterEach, describe, expect, it, vi } from "vitest";
import { assertUiAuditModeIsSafe, isUiAuditMode } from "@/lib/ui-audit-mode";

afterEach(() => vi.unstubAllEnvs());

describe("UI audit mode safety", () => {
  it("is opt-in and development-only", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("UI_AUDIT_MODE", "true");
    expect(isUiAuditMode()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isUiAuditMode()).toBe(false);
  });

  it("fails startup when the bypass flag reaches production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UI_AUDIT_MODE", "true");
    expect(() => assertUiAuditModeIsSafe()).toThrow(/cannot be enabled in production/i);
  });
});
