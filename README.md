# MTI Korea AI Business OS

Production Next.js application for long-lived AI-managed projects, agendas, execution runs, reports, knowledge, and client data.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app starts with one empty MTI Korea workspace. No login is required in this release.
Without infrastructure credentials, API data uses the process-local development repository and command confirmations remain locally queued.

## Architecture

- Next.js App Router and REST APIs under `/api/v1`
- Drizzle schema for organization-scoped PostgreSQL state
- Persisted run-event contract with SSE delivery
- LiteLLM as the only model gateway
- Managed Trigger.dev dispatch boundary for background workflows
- Railway PostgreSQL, Redis, private services, and Storage Buckets

## Database

```bash
npm run db:generate
npm run db:migrate
```

See `railway/README.md` for the production service topology and `prototype/` for the sanitized archived design reference.
