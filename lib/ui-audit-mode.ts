import type { SessionClaims } from "@/lib/auth";

const UI_AUDIT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const UI_AUDIT_OPERATOR_ID = "00000000-0000-4000-8000-000000000002";

/**
 * A local-only authenticated fixture workspace for visual and interaction QA.
 * The production check is intentionally repeated at every boundary so a bad
 * environment variable can never turn into a production authentication bypass.
 */
export function isUiAuditMode(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NODE_ENV !== "production" && environment.UI_AUDIT_MODE === "true";
}

export function assertUiAuditModeIsSafe(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV === "production" && environment.UI_AUDIT_MODE === "true") {
    throw new Error("UI_AUDIT_MODE cannot be enabled in production.");
  }
}

export function uiAuditClaims(now = Date.now()): SessionClaims {
  return {
    sessionId: "00000000-0000-4000-8000-000000000099",
    userId: UI_AUDIT_OPERATOR_ID,
    organizationId: UI_AUDIT_ORGANIZATION_ID,
    role: "admin",
    name: "UI Audit Operator",
    username: "ui-audit",
    issuedAt: now,
    expiresAt: now + 12 * 60 * 60 * 1000,
    nonce: "local-ui-audit-session"
  };
}
