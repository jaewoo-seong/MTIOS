const baseUrl = process.env.APP_URL;
const username = process.env.APP_BASIC_AUTH_USER;
const password = process.env.APP_BASIC_AUTH_PASSWORD;

if (!baseUrl || !username || !password) {
  throw new Error("APP_URL, APP_BASIC_AUTH_USER, and APP_BASIC_AUTH_PASSWORD are required.");
}

const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

async function expectJson(path, expectedStatus, authenticated = false) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authenticated ? { Authorization: auth } : undefined
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}; expected ${expectedStatus}`);
  }
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json()
    : null;
}

const health = await expectJson("/api/health", 200);
for (const dependency of ["database", "redis", "storage", "litellm", "documentConversion"]) {
  if (health.checks?.[dependency] !== "ok") {
    throw new Error(`${dependency} health check is not ok.`);
  }
}

await expectJson("/", 401);
const projects = await expectJson("/api/v1/projects", 200, true);
if (!Array.isArray(projects.data)) {
  throw new Error("Projects API returned an invalid shape.");
}
const modelSettings = await expectJson("/api/v1/settings/models", 200, true);
if (modelSettings.gateway !== "LiteLLM" || modelSettings.health !== "ok") {
  throw new Error("Model routing settings are not healthy.");
}
const preferences = await expectJson("/api/v1/settings/preferences", 200, true);
if (!["en", "ko"].includes(preferences.data?.locale)) {
  throw new Error("Workspace locale settings returned an invalid shape.");
}
const tools = await expectJson("/api/v1/mcp/tools", 200, true);
if (!Array.isArray(tools.data) || tools.data.length === 0) {
  throw new Error("MCP tool catalog is unavailable.");
}

console.log("Production smoke test passed.");
