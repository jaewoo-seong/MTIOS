const baseUrl = process.env.APP_URL;
const email = process.env.SMOKE_AUTH_EMAIL ?? "operator@mti.local";
const password = process.env.SMOKE_AUTH_PASSWORD ?? process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (!baseUrl || !password) {
  throw new Error("APP_URL and SMOKE_AUTH_PASSWORD or ADMIN_BOOTSTRAP_PASSWORD are required.");
}

async function expectJson(path, expectedStatus, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: "manual"
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}; expected ${expectedStatus}`);
  }
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json()
    : null;
}

const health = await expectJson("/api/health", 200);
for (const dependency of [
  "database", "redis", "storage", "litellm", "documentConversion", "authentication"
]) {
  if (health.checks?.[dependency] !== "ok") {
    throw new Error(`${dependency} health check is not ok.`);
  }
}

await expectJson("/api/v1/projects", 401);
const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password })
});
const loginPayload = await login.json();
if (login.status !== 200) {
  throw new Error(`Login returned ${login.status}: ${loginPayload.error ?? "unknown error"}`);
}
if (loginPayload.data?.forcePasswordChange) {
  throw new Error("Smoke account requires a password change before protected API checks.");
}
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Login returned no session cookie.");

const session = await expectJson("/api/v1/auth/session", 200, cookie);
if (session.data?.user?.role !== "admin") {
  throw new Error("Smoke account is not an administrator.");
}
const projects = await expectJson("/api/v1/projects", 200, cookie);
if (!Array.isArray(projects.data)) {
  throw new Error("Projects API returned an invalid shape.");
}
const modelSettings = await expectJson("/api/v1/settings/models", 200, cookie);
if (modelSettings.gateway !== "LiteLLM" || modelSettings.health !== "ok") {
  throw new Error("Model routing settings are not healthy.");
}
const preferences = await expectJson("/api/v1/settings/preferences", 200, cookie);
if (!["en", "ko"].includes(preferences.data?.locale)) {
  throw new Error("Workspace locale settings returned an invalid shape.");
}
const analytics = await expectJson("/api/v1/admin/ai-analytics", 200, cookie);
if (!Array.isArray(analytics.data?.rows)) {
  throw new Error("AI analytics returned an invalid shape.");
}
const tools = await expectJson("/api/v1/mcp/tools", 200, cookie);
if (!Array.isArray(tools.data) || tools.data.length === 0) {
  throw new Error("MCP tool catalog is unavailable.");
}

console.log("Production smoke test passed.");
