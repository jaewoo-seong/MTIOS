/**
 * Runs once when the server process starts, before it accepts traffic.
 *
 * This is the only place configuration can be checked early enough to matter.
 * Checking inside a request handler means the first person to hit the wrong
 * endpoint discovers the problem; checking here means the deploy does.
 */
export async function register() {
  // Next imports server modules and may invoke instrumentation while collecting
  // route data. Builds must be reproducible without production secrets; the
  // same compiled hook runs again when the server process actually starts.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Guarded because `register` also runs in the Edge runtime, where there is no
  // process to fail and none of these variables are readable the same way.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertUiAuditModeIsSafe } = await import("@/lib/ui-audit-mode");
  assertUiAuditModeIsSafe();

  const { assertConfig, inspectConfig } = await import("@/lib/config");
  const { logger } = await import("@/lib/observability/logger");

  const report = inspectConfig();
  for (const notice of report.notices) {
    logger.warn("config.degraded", { detail: notice });
  }

  if (process.env.NODE_ENV === "production") {
    // Throws, which aborts startup. A half-configured production instance that
    // accepts traffic is worse than one that refuses to boot.
    assertConfig();
    logger.info("config.verified", {
      requiredChecks: "passed",
      degradations: report.notices.length
    });
  }
}
