/**
 * The one HTTP boundary every Trigger.dev task in trigger/ uses for state
 * that lives in Postgres. Trigger tasks run in a separate worker process
 * (Managed Trigger.dev) that is not assumed to reach the app's database
 * directly - only `requestModel` (lib/ai/litellm.ts) has its own dual-mode
 * fallback for that reason. Everything else - campaign/candidate writes,
 * MCP tool invocation, run events - goes through here, to
 * app/api/internal/workflow/route.ts, authenticated by
 * WORKFLOW_CALLBACK_SECRET.
 */
export async function callWorkflowApp<T>(body: Record<string, unknown>): Promise<T> {
  const baseUrl = process.env.BUSINESS_OS_INTERNAL_URL;
  const secret = process.env.WORKFLOW_CALLBACK_SECRET;
  if (!baseUrl || !secret) {
    throw new Error("Workflow app callback is not configured.");
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/internal/workflow`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Workflow app request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}
