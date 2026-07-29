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
