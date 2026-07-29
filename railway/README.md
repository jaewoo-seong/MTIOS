# Railway topology

Create services for:

- `app`: this repository, with PostgreSQL, Redis, bucket, LiteLLM, and Trigger variables.
- `postgres`: authoritative business state and LiteLLM accounting.
- `redis`: cache, rate limiting, and transient coordination only.
- `litellm`: deploy `railway/litellm/Dockerfile` and expose it only over Railway private networking.
- `mcp-tools`: internal scoped tool adapters. Do not expose this service publicly.
- `bucket`: generated reports, exports, and attachments.

Managed Trigger.dev remains external. Set `TRIGGER_DISPATCH_URL` to the deployed command workflow endpoint and use the command ID as its idempotency key.

The app health check is `/api/health`. Run migrations as a Railway pre-deploy command after a PostgreSQL service is connected.

Phase 2 context retrieval requires PostgreSQL `pgvector`; migration `0003`
creates the extension, full-text index, and HNSW vector index. Configure
`LITELLM_EMBEDDING_ROUTE` with a multilingual embedding route exposed by the
private LiteLLM service. Keep embedding provider/model credentials in LiteLLM,
not the application service.

Build `mcp-tools` from `railway/mcp-tools/Dockerfile`. Set
`MCP_SERVICE_SECRET` to the same generated secret on `app` and `mcp-tools`,
and set `MCP_SERVICE_URL` on `app` to
`http://mcp-tools.railway.internal:3002/mcp`. Keep the service private; only
its `/health` endpoint is used by Railway health checks.

Gmail uses server-side Google OAuth on the public `app` service. Configure
`GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, and a generated
base64-encoded 32-byte `GMAIL_TOKEN_ENCRYPTION_KEY`. Register
`https://<app-domain>/api/v1/integrations/gmail/callback` in Google Cloud.
The app requests only `gmail.readonly` and `gmail.compose`; refresh tokens are
encrypted in PostgreSQL. Set the same three Gmail variables on the private
`mcp-tools` service so its Gmail adapters can refresh and decrypt tokens.
These credentials are separate from `MCP_SERVICE_SECRET` and must not be used
as MCP transport authentication.
