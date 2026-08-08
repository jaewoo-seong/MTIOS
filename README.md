# MTI Korea AI Business OS

Production-oriented Next.js workspace for continuous client discovery, company qualification, bounded dossier research, and linked client records.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Normal operation requires a signed-in company account. For visual and interaction QA, the explicit local-only UI audit mode provides deterministic fixture data and disables provider access:

```bash
UI_AUDIT_MODE=true NEXT_PUBLIC_UI_AUDIT_MODE=true npm run dev
```

Without infrastructure credentials, normal development API data uses the process-local repository and empties when the server restarts.

## Architecture

- Next.js App Router and REST APIs under `/api/v1`
- Drizzle schema for organization-scoped PostgreSQL state
- Continuous discovery queue and bounded dossier-worker contract
- LiteLLM as the only model gateway, with task-aware free OpenRouter worker routing
- Managed Trigger.dev dispatch boundary for background workflows
- Railway PostgreSQL, Redis, private services, and Storage Buckets

## Database

```bash
npm run db:generate
npm run db:migrate
```

See [docs/product-boundary.md](docs/product-boundary.md) for the active product boundary, [docs/document-importing.md](docs/document-importing.md) for supported imports, and `railway/README.md` for the production service topology.
