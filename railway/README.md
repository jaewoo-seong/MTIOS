# Railway topology

Create services for:

- `app`: this repository, with PostgreSQL, Redis, bucket, LiteLLM, and Trigger variables.
- `postgres`: authoritative business state and LiteLLM accounting.
- `redis`: cache, rate limiting, and transient coordination only.
- `litellm`: deploy `railway/litellm/Dockerfile` and expose it only over Railway private networking.
- `mcp-tools`: internal scoped tool adapters. Do not expose this service publicly.
- `document-conversion`: private layout extraction, Korean/English OCR, page
  previews, and PDF/DOCX export service.
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

Build `document-conversion` from
`railway/document-conversion/Dockerfile`. Generate
`DOCUMENT_CONVERSION_SERVICE_SECRET`, set it on `app` and
`document-conversion`, and configure
`DOCUMENT_CONVERSION_SERVICE_URL=http://document-conversion.railway.internal:3003`.
Give the service Railway bucket variables so page previews and extracted
images remain private objects. Its image includes English/Korean Tesseract and
Noto CJK fonts for Korean OCR and exports.

## Model routing

Configure full LiteLLM model identifiers, not short provider aliases:

- `EXECUTIVE_MODEL`
- `NVIDIA_WORKER_MODEL`
- `NVIDIA_EMBEDDING_MODEL`
- `NVIDIA_RERANKING_MODEL`
- `OPENROUTER_FREE_MODEL`

Keep `NVIDIA_PRODUCTION_APPROVED=false` until commercial use, retention,
privacy, regional availability, quota, and reliability have been reviewed.
OpenRouter free remains testing-only. Rotate any credential ever pasted into a
chat or log before deployment.

## Production gate

Deployment order:

1. Provision PostgreSQL, Redis, bucket, LiteLLM, MCP tools, and document
   conversion services on Railway private networking.
2. Set app and service variables. Generate distinct workflow, MCP, document
   conversion, Gmail encryption, LiteLLM, and Basic Auth secrets.
3. Run `npm run db:deploy` once against production PostgreSQL.
4. Deploy Trigger.dev production tasks and verify production concurrency.
5. Deploy the app, require `/api/health` status `ok`, then run
   `npm run test:production`.
6. Test one Executive call, worker fallback, embedding, reranking, MCP read,
   Korean PDF conversion, Gmail OAuth/read/draft, report export, SSE reconnect,
   approval, and rollback.
7. Confirm budgets, audit logs, signed object URLs, backup/restore, alerts, and
   secret rotation before admitting business data.

The build is not production-ready while any health dependency is
`not_configured`, worker routes lack a production-approved candidate, provider
terms remain unreviewed, or the production smoke sequence has not passed.
