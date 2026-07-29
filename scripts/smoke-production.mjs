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
for (const dependency of ["database", "redis", "storage", "litellm"]) {
  if (health.checks?.[dependency] !== "ok") {
    throw new Error(`${dependency} health check is not ok.`);
  }
}

await expectJson("/", 401);
const projects = await expectJson("/api/v1/projects", 200, true);
if (!Array.isArray(projects.data)) {
  throw new Error("Projects API returned an invalid shape.");
}

console.log("Production smoke test passed.");
