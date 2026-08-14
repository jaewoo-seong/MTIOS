import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpointValue = process.env.MTI_MCP_ENDPOINT;
const token = process.env.MTI_MCP_TOKEN;

if (!endpointValue || !token) {
  console.error("Set MTI_MCP_ENDPOINT (including /mcp) and MTI_MCP_TOKEN.");
  process.exit(2);
}

const endpoint = new URL(endpointValue);
if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname)) {
  console.error("Refusing to send an MCP credential over non-HTTPS outside localhost.");
  process.exit(2);
}

const healthUrl = new URL("/health", endpoint);
const healthResponse = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
if (!healthResponse.ok) throw new Error(`Gateway health check failed (${healthResponse.status}).`);

const client = new Client({ name: "mti-production-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { authorization: `Bearer ${token}` } }
});

try {
  await client.connect(transport);
  const instructions = client.getInstructions() ?? "";
  if (!instructions.includes("external conversational collaborator")) {
    throw new Error("Gateway did not return the expected MTI assistant instructions.");
  }

  const [{ tools }, { resources }, { prompts }] = await Promise.all([
    client.listTools(),
    client.listResources(),
    client.listPrompts()
  ]);
  if (!tools.length) throw new Error("Credential exposes no MCP tools.");
  if (!resources.some((resource) => resource.uri === "mti://external-assistant-role")) {
    throw new Error("MTI assistant role resource is missing.");
  }

  const expectedTools = (process.env.MTI_MCP_EXPECTED_TOOLS ?? "")
    .split(",").map((name) => name.trim()).filter(Boolean);
  const missing = expectedTools.filter((name) => !tools.some((tool) => tool.name === name));
  if (missing.length) throw new Error(`Expected tools are missing: ${missing.join(", ")}.`);

  if (tools.some((tool) => tool.name === "list_research_projects")) {
    const result = await client.callTool({ name: "list_research_projects", arguments: { limit: 1 } });
    if (result.isError) throw new Error("Read-only project smoke call returned an MCP error.");
  }

  console.log(JSON.stringify({
    status: "ok",
    protocol: "streamable-http",
    toolCount: tools.length,
    resourceCount: resources.length,
    promptCount: prompts.length,
    tools: tools.map((tool) => tool.name)
  }));
} finally {
  await client.close();
}
