# Railway topology

Create services for:

- `app`: this repository, with PostgreSQL, Redis, bucket, LiteLLM, and Trigger variables.
- `postgres`: authoritative business state and LiteLLM accounting.
- `redis`: cache, rate limiting, and transient coordination only.
- `litellm`: deploy `railway/litellm/Dockerfile` and expose it only over Railway private networking.
- `mcp-tools`: internal scoped tool adapters. Do not expose this service publicly.
- `mcp-external`: public authenticated conversational access for Codex, Claude,
  Gemini, and other MCP clients. It exposes only the external tool catalog.
- `document-conversion`: optional advanced PDF/DOCX export service. Document
  importing itself accepts UTF-8 text, Markdown, and preflighted simple DOCX
  locally; PDF/OCR import is intentionally disabled.
- `bucket`: generated reports, exports, and attachments.

Managed Trigger.dev remains external. Set `TRIGGER_DISPATCH_URL` to the deployed command workflow endpoint and use the command ID as its idempotency key.

The app health check is `/api/health`. Apply migrations manually before the corresponding app release; the current production image omits Drizzle Kit and cannot run them as a pre-deploy command.

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

Build `mcp-external` from `railway/mcp-external/Dockerfile` and give it a public
Railway domain. Generate a distinct `EXTERNAL_MCP_GATEWAY_SECRET` of at least
32 characters and set the same value on `app` and `mcp-external`. Configure the
gateway with `BUSINESS_OS_INTERNAL_URL=http://app.railway.internal:3000` and set
`EXTERNAL_MCP_ALLOWED_HOSTS` to its public hostname. Configure
`EXTERNAL_MCP_ALLOWED_ORIGINS` only for browser-based MCP clients; native clients
normally send no Origin header. Set `EXTERNAL_MCP_INTERNAL_TIMEOUT_MS=15000`
(or a lower value than the public platform timeout). Do not reuse
`MCP_SERVICE_SECRET`.

Apply migrations through `0033_clammy_boomerang.sql`, then create an external MCP
credential through the admin API. The client endpoint is:

```text
https://<mcp-external-domain>/mcp
Authorization: Bearer mti_mcp_<prefix>_<secret>
```

The public catalog is credential-filtered. Read access includes
`list_research_projects`, `get_research_project`, `get_project_briefing`,
`search_business_os`, `get_company_research`, and `get_document`. Phase 3 adds
`draft_research_project` and `activate_research_project` only when their separate
scopes are granted. Compatible clients also discover the
`mti://external-assistant-role` resource and `brainstorm_project` prompt. Health
checks use `/health` and reveal no credential state.

After deployment, follow `docs/mcp/phase-5-production.md` and run
`npm run test:mcp:external` with a disposable, read-only, selected-project
credential before enabling any write scopes.

Gmail uses server-side Google OAuth on the public `app` service. Configure
`GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, and a generated
base64-encoded 32-byte `GMAIL_TOKEN_ENCRYPTION_KEY`. Register
`https://<app-domain>/api/v1/integrations/gmail/callback` in Google Cloud.
The app requests only `gmail.send`; refresh tokens are
encrypted in PostgreSQL. Set the same three Gmail variables on the app and
Trigger.dev environment so notification-delivery workers can refresh and
decrypt tokens. The private `mcp-tools` service does not receive Gmail
credentials or expose Gmail tools.
These credentials are separate from `MCP_SERVICE_SECRET` and must not be used
as MCP transport authentication. Connect the administrator-owned mailbox and
mark it as the service sender in Settings before enabling automated notifications.
Deploy the Trigger.dev `email-notification-delivery` and
`email-notification-outbox-sweep` tasks; the latter recovers queued or stale
deliveries every minute. The full setup, OAuth verification notes, retry model,
and incident procedure are in `docs/email-notifications.md`.

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

**OpenRouter is the only configured provider.** One key,
`OPENROUTER_API_KEY`, serves every route. Three model
variables:

- `EXECUTIVE_MODEL` — planning and review
- `PREMIUM_FALLBACK_MODEL` — the admin-approved escalation; deliberately its own variable rather than an alias of
  `EXECUTIVE_MODEL`, so approving a premium fallback is a real choice
- Worker aliases are pinned explicitly in `config.yaml` to current OpenRouter
  `:free` models, specialized for research, long-form writing, multilingual
  editing/translation, structured extraction, and fast classification.

The two premium variables live on the **litellm** service. Worker model
changes use the curated LiteLLM aliases and the test/approve/activate flow in
Settings, so an activated revision changes the model actually invoked without
a gateway redeploy.

Keep structured-output routes on a catalog model that supports JSON because
discovery, qualification, and dossier query planning depend on it.

### No embeddings, by choice

`multilingual_embedding` and `multilingual_reranking` have **no LiteLLM
entry**: OpenRouter serves no embedding models at all (its catalog outputs
only text, image, and audio). Semantic retrieval is therefore unavailable and
`lib/context/retrieval.ts` degrades to lexical scoring, tagging results
`lexical_fallback` — a path it handles deliberately rather than failing.

To restore semantic search, add an embedding provider to
`railway/litellm/config.yaml` (NVIDIA NIM, OpenAI, Voyage, Cohere) with its
model variable. No app code needs to change.

NVIDIA support was removed rather than left half-wired: entries pointing at
unset `NVIDIA_*` variables would fail the config at startup, and a candidate
listed in `lib/ai/model-policy.ts` with no reachable route would have made
Settings advertise a provider that cannot serve a request.
`ModelCandidate.provider` still admits `"nvidia"`, so re-adding it is small.

> **The litellm service does not deploy from GitHub.** Its build context is a
> local upload (`Dockerfile` + `config.yaml`, ~631 bytes) — deployments carry
> no commit metadata, unlike `app`. Editing `railway/litellm/config.yaml` in
> the repo changes nothing in production until you upload it. Set the
> variables *before* uploading a config that references them.
>
> **Do not run `railway up` from inside this repo.** It takes its build
> context from the **git root**, not the current directory, so running it in
> `railway/litellm/` uploads the whole repo; RAILPACK then detects the Next.js
> project and deploys *the app* onto the litellm service, taking model routing
> down. The deploy still reports SUCCESS — only the runtime logs reveal it
> (`next start` instead of Uvicorn). This happened on 2026-07-30.
>
> Setting `rootDirectory` + `dockerfilePath` does **not** fix it; the builder
> stays RAILPACK and fails with "Script start.sh not found".
>
> Correct procedure — stage the two files outside any git repo:
>
> ```bash
> mkdir /tmp/litellm-deploy
> cp railway/litellm/Dockerfile railway/litellm/config.yaml /tmp/litellm-deploy/
> cd /tmp/litellm-deploy
> railway up --project <project-id> --environment <environment-id> \
>   --service <litellm-service-id> --ci
> ```
>
> Resolve and copy all three IDs from `railway status --json` while still in
> the linked repository. A service name alone is not sufficient from an
> unlinked temporary directory: Railway may create a new project instead.
>
> Then confirm from the runtime logs that Uvicorn is serving on port 4000, and
> that no unexpected model literal appears in the `register_model` warnings.

`NVIDIA_PRODUCTION_APPROVED` is moot while no NVIDIA candidate exists — the
flag gates a candidate, it cannot conjure one. Leave it unset. Note also that
`candidates` in `lib/ai/model-policy.ts` drives only quota math and the
Settings display; it never changes which `model_name` LiteLLM is asked for, so
adding a second candidate does not by itself route traffic to it.

## Web search

Tavily is the only general web-search provider. Set both keys on **app**
(`lib/research/engine.ts` runs in-process there, not in `mcp-tools`):

- `TAVILY_API_KEY` — primary
- `TAVILY_API_KEY_BACKUP` — second authorized account, tried automatically
  when the primary is rate-limited or out of quota
- `TAVILY_API_KEY_3` — optional third authorized account

Official-site mapping and scraping use Firecrawl account slots on `app`:

- `FIRECRAWL_API_KEY`
- `FIRECRAWL_API_KEY_2`
- `FIRECRAWL_API_KEY_3`

The account pool rotates only on quota/rate-limit or provider failure and
records usage per account. The default dossier caps Firecrawl Map at 16 URLs
and scrapes at most 8 pages, preventing a broad site map from consuming an
entire free allowance for one company.

Bounded official-registry dossier enrichment also runs on `app`:

- `OPENDART_API_KEY` — Korean company directory, profile, and recent filings
- `KOREAN_PUBLIC_DATA_SERVICE_KEY` — Korean business-status verification when
  the candidate already has a 10-digit business registration number
- `SAM_GOV_API_KEY` — optional U.S. government-registered entity lookup
- `CENSUS_API_KEY` — U.S. market statistics (the Census Data API now requires
  a key)

GLEIF global legal-entity lookup and SEC EDGAR lookup require no key. The
dossier enrichment path is country-aware: it does not call every registry for
every company, and the campaign evidence pool caches the result for reuse.

Brave was removed deliberately, and Wikimedia no longer claims the `web`
category. Redundancy comes from a second key on the same service rather than a
different search engine, so a Tavily outage surfaces as an outage instead of
silently returning encyclopedia results that read as thin coverage. Providers
self-seed from `researchProviderCatalog` and gate purely on the env var being
present — there is no database row to create.

Rotate any credential ever pasted into a chat or log before deployment.

## Production gate

Deployment order:

1. Provision PostgreSQL, Redis, bucket, LiteLLM, MCP tools, and document
   conversion services on Railway private networking.
2. Set app and service variables. Generate distinct workflow, MCP, document
   conversion, Gmail encryption, LiteLLM, and Basic Auth secrets.
3. Apply migrations. `DATABASE_URL` resolves to `postgres.railway.internal`,
   unreachable from a laptop, so run them through the Postgres service's
   public proxy — the credential stays inside the child process:

   ```bash
   railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx drizzle-kit migrate'
   ```

   Then confirm against `information_schema` rather than trusting the output.
   Do **not** set this as a Railway pre-deploy command: `drizzle-kit` is a
   devDependency and Railway installs with `--omit=dev`, so it would fail and
   block every future deploy.
4. Deploy Trigger.dev production tasks and verify production concurrency.

   Pin the CLI to the installed SDK version — do **not** use `@latest`:

   ```bash
   npx trigger.dev@4.5.8 deploy   # must match @trigger.dev/sdk in package.json
   ```

   `npx trigger.dev@latest` aborts with "Version mismatch detected while
   running in CI" the moment the published CLI moves ahead of the pinned SDK,
   which it did on 2026-07-30 (CLI 4.5.9 vs SDK 4.5.8). Confirm the summary
   line reports the expected task count — the app triggers tasks by id, so a
   task missing from the deploy fails only when something calls it.
5. Deploy the app, require `/api/health` status `ok`, then run
   `npm run test:production`.
6. Test one Executive call, worker fallback, embedding, reranking, MCP read,
   Korean PDF conversion, Gmail OAuth notification sending, report export, SSE reconnect,
   approval, and rollback.
7. Confirm budgets, audit logs, signed object URLs, backup/restore, alerts, and
   secret rotation before admitting business data.

The build is not production-ready while any health dependency is
`not_configured`, worker routes lack a production-approved candidate, provider
terms remain unreviewed, or the production smoke sequence has not passed.
