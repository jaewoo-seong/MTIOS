# MTI Korea AI Business OS - Implementation Plan

## Purpose

This document is the implementation handoff for the MTI Korea AI Business OS.
The product is a general-purpose Business Operating System with research-heavy
capabilities, not a research-only application. It must support long-lived
projects, research, marketing, brainstorming, content, data operations,
documents, communications, and future business integrations.

Railway hosts the application, PostgreSQL, Redis, LiteLLM, storage, and private
internal services. Managed Trigger.dev executes background workflows.
PostgreSQL remains authoritative, and the application communicates with model
providers only through LiteLLM.

## Mandatory Handoff and Audit Protocol

Before implementing any phase:

1. Read this document, `README.md`, `railway/README.md`, the current Drizzle
   schema, API routes, workflow code, and LiteLLM configuration.
2. Run `git status` and preserve all existing user changes. Never revert,
   overwrite, or reformat unrelated work.
3. Audit the current UI in the browser at laptop and desktop widths. Compare
   the implemented navigation, Project Command Center, Executive Command,
   Documents, Client & Data, Knowledge Base, and Settings against the phase.
4. Identify features already implemented, partially implemented, obsolete, or
   contradicted by newer design work. Do not duplicate existing functionality.
5. Present the audit, proposed changes, schema/API impact, risks, credential
   requirements, and test plan before editing.
6. Obtain explicit implementation authorization. Audit and planning permission
   alone does not authorize code, database, infrastructure, or deployment
   changes.
7. Implement one phase in reviewable increments. Validate migrations, tests,
   responsive UI, workflows, permissions, and production health before moving
   to the next phase.
8. Update this document with completion status, decisions, migrations,
   deployment identifiers, and remaining risks.

Do not request API keys until the phase that uses them is approved. Secrets
must be entered into Railway, Trigger.dev, or the provider's secret store and
must never be committed or repeated in documentation, logs, screenshots, or
chat responses.

## Product-Wide Invariants

- All organization data is scoped by organization and, where applicable, user.
- The Executive Agent plans, delegates, reviews, and communicates; workers
  receive limited context and tools.
- Ambiguous instructions require clarification before execution.
- External sends, publishing, destructive operations, high-cost actions, and
  client-database mutations require persisted user approval.
- Every output remains linked to its project, agenda, run, model calls, tool
  calls, sources, and review history.
- Model, tool, workflow, and database operations are idempotent and auditable.
- English, Korean, and bilingual work can coexist in one workspace.
- Free APIs and model endpoints are testing resources unless their production
  availability, privacy, retention, and commercial-use terms are approved.

---

## Phase 1 - General Project and Agent Foundation

### Objective

Establish the durable project, agenda, task, decision, deliverable, review, and
agent contracts used by every later capability.

### Implementation

- Model projects with objectives, context, scope, constraints, budgets,
  permissions, milestones, review gates, output requirements, and status.
- Add agenda work types: research, marketing, brainstorming, content, data
  enrichment, documents, communication, analysis, operations, and custom.
- Add durable tasks, dependencies, worker assignments, decisions, assumptions,
  unresolved questions, deliverables, and revisions.
- Make Executive Command attach the current page, project, selected records,
  document, knowledge entry, and client database when relevant.
- Persist command drafts, clarification answers, confirmations, plans, and
  execution state across navigation and reconnects.
- Define worker capabilities, permitted tools, budgets, output schemas, and
  review requirements by agenda type.
- Reconcile all work with the latest design audit before changing composition
  or navigation.

### Acceptance

- One project can contain multiple agenda types over months without losing
  history.
- Commands clarify, confirm, create agendas, and remain attached to the correct
  project and selected context.
- Tasks, decisions, outputs, and reviews are traceable to their originating run.

---

## Phase 2 - Context and Organizational Memory

### Objective

Replace fixed context snapshots with durable, relevant, cited, multilingual
context retrieval.

### Implementation

- Implement four layers: workspace memory, project memory, agenda memory, and
  task-specific run context.
- Enable PostgreSQL full-text search and `pgvector`.
- Chunk documents, reports, decisions, knowledge, client records, and prior
  outputs with source metadata and stable content hashes.
- Add a configurable multilingual embedding route through LiteLLM.
- Build context packs using organization/project filters, relevance, approval
  status, authority, freshness, language, deduplication, and token budgets.
- Store context-pack contents, citations, retrieval scores, and model usage for
  audit and reproducibility.
- Never treat proposed or rejected memory as authoritative.

### Acceptance

- Workers receive only relevant scoped passages rather than complete project
  histories.
- English and Korean queries retrieve appropriate source-language content.
- Every factual context item can be traced to its source and retrieval event.

---

## Phase 3 - Reusable Workflow and Worker Framework

### Objective

Support multiple business workflows without hard-coding orchestration around
research.

### Implementation

- Define workers for research, company intelligence, marketing strategy,
  ideation, content writing, editing, extraction, data enrichment, document
  generation, email drafting, translation, and quality review.
- Use structured inputs and outputs for plans, delegated tasks, results,
  review recommendations, and deliverables.
- Use Trigger.dev for fan-out, retries, schedules, cancellation, resumability,
  deadlines, approval pauses, and dead-letter handling.
- Persist every workflow transition, Trigger.dev identifier, retry, error,
  model call, tool call, token count, and cost in PostgreSQL.
- Add failure callbacks so runs cannot remain queued or executing after a
  workflow reaches a terminal state.
- Add per-run, per-agenda, per-project, and per-organization budgets.

### Acceptance

- Marketing, brainstorming, document, data, and research agendas use the same
  orchestration framework with different workers and controls.
- Retries do not duplicate tasks or outputs.
- Failed, cancelled, expired, and completed workflows reconcile correctly.

---

## Phase 4 - Canonical Company Research

### Objective

Make company research reusable across projects and prevent repeated discovery,
research, and enrichment.

### Implementation

- Create an organization-wide canonical company registry.
- Store legal and trading names, normalized domain, locations, registration
  IDs, CIK, LEI, classifications, sources, confidence, completeness, first
  researched date, last verified date, and linked projects.
- Deduplicate in order: official identifier, LEI/CIK, domain, normalized name
  plus country, then fuzzy name/address comparison.
- Require review before merging fuzzy or conflicting matches.
- Create durable research campaigns with scope, qualification rules, target
  count, required fields, exclusions, sources, queries, segments, yield,
  saturation, costs, and estimated remaining population.
- Classify in-scope records as reusable, stale, incomplete, rejected,
  duplicate, unresolved, or new.
- Use atomic claims and expiring leases before assigning a company to a worker.
- Tell the user how many existing companies match and ask whether they count
  toward the requested target.
- Stop and clarify when the eligible market is exhausted or scope must change.

### Acceptance

- Later projects reuse current company research without repeating it.
- Parallel workers and workflow retries cannot research the same company.
- Rejected and duplicate candidates remain known and are not rediscovered
  without changed scope or new evidence.
- The agent reports when the requested population is unavailable.

---

## Phase 5 - Marketing and Brainstorming

### Objective

Provide durable creative and strategic workflows alongside research.

### Implementation

- Add marketing campaign objectives, audiences, positioning, brand voice,
  approved claims, competitors, channels, formats, calendars, concepts,
  variants, assumptions, and approval state.
- Add brainstorming sessions with prompts, alternatives, evaluation criteria,
  shortlists, rejected ideas and reasons, decisions, and experiments.
- Retrieve approved brand, client, project, and prior campaign context.
- Produce editable briefs, campaign plans, calendars, copy, creative concepts,
  decision memos, and experiment plans.
- Keep publication, sending, ad activation, and external system changes behind
  explicit review gates.

### Acceptance

- Creative alternatives and decision reasoning survive across agendas.
- Marketing work uses approved brand facts without treating drafts as policy.
- No content is externally published without approval.

---

## Phase 6 - MCP Tool Platform

### Objective

Standardize internal and external tool access without coupling agents directly
to provider SDKs.

### Implementation

- Deploy a private Railway `mcp-tools` service using Streamable HTTP.
- Make the application the MCP host/client and maintain a scoped connection to
  each approved MCP server.
- Register tools, resources, prompts, schemas, permissions, budgets, risk
  levels, approval requirements, and health.
- Initial groups: internal search, project context, knowledge, client-data
  reads, staged writes, reports, documents, storage, and research.
- Add service authentication and never pass provider OAuth tokens through from
  the MCP client to downstream services.
- Record every tool discovery, invocation, input, output, error, duration, and
  approval link.
- Design extension points for CRM, calendar, analytics, publishing, ERP,
  accounting, cloud storage, and manufacturing systems.

### Acceptance

- Agents can discover and call only tools allowed for their role and project.
- Sensitive tools pause for approval.
- New MCP integrations can be added without changing core orchestration.

---

## Phase 7 - Research Sources

### Objective

Provide reliable, cited research across web, business, government, Korean, and
academic sources.

### Implementation

- Add Tavily as broad web-search primary and Brave as fallback.
- Add SEC EDGAR, U.S. Census, World Bank, FRED, Korean Public Data Portal,
  KOSIS, OpenAlex, Crossref, Semantic Scholar, Wikimedia, and Wikidata tools.
- Normalize results into source records with publisher, URL, retrieval date,
  source language, license, content hash, citation, confidence, and cache state.
- Add rate limiting, caching, backoff, provider fallback, source-quality
  scoring, domain policies, and per-agenda query budgets.
- Preserve original evidence separately from model summaries.
- Make unavailable, contradictory, stale, and low-confidence evidence visible
  in reports and review screens.

### Credentials Required When Approved

- Tavily API key
- Brave Search API key
- FRED API key
- U.S. Census API key
- Korean Public Data Portal service key
- KOSIS API key
- Semantic Scholar API key if authenticated limits are required

SEC, World Bank, Crossref, and Wikimedia access normally do not require private
keys, but their current usage policies must still be checked at implementation.

### Acceptance

- Reports contain working citations and retrieval provenance.
- Provider outages and rate limits trigger bounded fallback rather than silent
  loss of evidence.
- Research costs and source coverage are visible per agenda.

---

## Phase 8 - Staged Client Database Changes

### Objective

Let agents propose useful database changes without permitting automatic writes.

### Implementation

- Stage proposed new records, field updates, duplicate matches, merges,
  conflicting values, validation warnings, sources, and confidence.
- Show current and proposed values side by side in the Project Command Center.
- Provide actions to approve selected, reject selected, request more research,
  edit proposals, or export without applying.
- Persist exact change sets with destination database/table, before/after
  values, source evidence, approving user, timestamp, expiration, and
  idempotency key.
- Treat chat instructions such as "add those companies" as requests to open
  the same confirmation interface.
- After approval, revalidate current values, pause on conflicts, apply changes
  transactionally, and store audit and rollback snapshots.
- Invalidate approval if the proposal changes.

### Acceptance

- No client record changes without explicit approval.
- Approval applies only to the displayed records and field values.
- Concurrent conflicts pause safely.
- Writes are transactional, idempotent, auditable, and reversible.

---

## Phase 9 - Gmail and Communications

### Objective

Add project-aware email context and drafting without autonomous sending.

### Implementation

- Use Google server-side OAuth with offline access.
- Encrypt refresh tokens and keep Google credentials separate from MCP service
  authentication.
- Initially request only `gmail.readonly` and `gmail.compose`.
- Add MCP tools for thread search, selected-message retrieval, summarization,
  attachment import, project/client/company linking, draft creation, and draft
  revision.
- Do not expose sending, permanent deletion, forwarding, delegation, or mailbox
  administration in the first release.
- Add a later send workflow requiring final-message review and a fresh approval
  immediately before execution.

### Credentials Required When Approved

- Google Cloud project with Gmail API enabled
- OAuth client ID and client secret
- Approved redirect URLs for local, preview, and production environments
- Google Workspace administrator approval if required

### Acceptance

- Authorized mail can be searched and linked to projects.
- Attachments enter the document pipeline with email provenance.
- Drafts can be created and revised, but the agent cannot send or delete mail.

---

## Phase 10 - Documents and PDF Intelligence

### Objective

Turn uploaded business files into editable, traceable documents while
preserving immutable originals.

### Implementation

- Store originals in Railway Storage before conversion.
- Deploy a private Railway conversion service using layout-aware extraction and
  OCR for scanned pages.
- Produce pages, blocks, tables, images, coordinates, confidence, editable
  Markdown/HTML, and links to original pages.
- Use AI repair only for low-confidence headings, reading order, and tables.
- Add conversion states, warnings, retries, revisions, and source-versus-edited
  views.
- Support Markdown, DOCX, PDF, and applicable CSV exports.
- Chunk approved document revisions for Phase 2 retrieval while preserving
  original and superseded versions.

### Acceptance

- Digital, scanned, table-heavy, English, and Korean PDFs become editable.
- Users can verify converted content against original pages.
- Failed or low-confidence extraction never silently becomes authoritative.

---

## Phase 11 - Model Routing and NVIDIA

### Objective

Route models by business role while keeping provider control, cost, and
fallback behavior visible.

### Implementation

- Keep LiteLLM as the only model gateway.
- Define routes for executive reasoning, executive review, research, creative
  ideation, writing, editing, structured extraction, translation, fast
  classification, embeddings, and reranking.
- Testing defaults: Claude Haiku for Executive Agent, approved NVIDIA models
  where suitable, and OpenRouter free as fallback.
- Add explicit ordered fallbacks, retries, circuit breakers, provider budgets,
  and structured-output validation.
- Store actual provider/model, tokens, cost, latency, error, fallback reason,
  and licensing status for every call.
- Validate commercial use, retention, privacy, regional availability, and
  production reliability before promoting free endpoints.

### Credentials Required When Approved

- NVIDIA API key
- Replacement/rotated OpenRouter API key
- Any additional paid-provider key selected for production fallbacks

### Acceptance

- Each route reports its actual selected model and fallback behavior.
- Provider failure does not silently change quality or exceed budgets.
- Testing-only and production-approved models are clearly distinguished.

---

## Phase 12 - Settings and Korean Support

### Objective

Expose operational configuration and support English, Korean, and bilingual
work in one workspace.

### Implementation

- Show model routes, ordered fallbacks, provider, pricing class, health, last
  successful model, usage, costs, limits, budgets, environment, and licensing.
- Show MCP servers, tools, permissions, connection health, OAuth state, and
  approval policy.
- Allow guarded model-route edits with validation, a test call, approval,
  version history, activation, and rollback.
- Add per-user locale, timezone, date, number, and currency preferences.
- Add per-project output language: English, Korean, or bilingual.
- Localize navigation, forms, validation, notifications, prompts, templates,
  reports, dates, currency, search, and exports.
- Preserve source language and use multilingual retrieval rather than forcing
  translation into English.

### Acceptance

- English and Korean users can work in the same organization.
- A project can generate English, Korean, or bilingual deliverables.
- Settings accurately reflects live routing and integration state.
- Configuration changes are tested, approved, versioned, and reversible.

---

## Final End-to-End Acceptance

1. Create a long-lived bilingual project with mixed research, marketing,
   brainstorming, document, data, and communication agendas.
2. Research companies, reuse existing company records, avoid duplicate work,
   and stop when the defined market is exhausted.
3. Review sourced company proposals and approve only selected client-database
   additions or updates.
4. Import a scanned Korean PDF and a Gmail attachment, convert both into
   editable documents, and retrieve cited passages in later work.
5. Produce English, Korean, and bilingual reports with source provenance.
6. Create an email draft linked to the project without permitting autonomous
   sending.
7. Verify every model, tool, workflow, approval, database write, document
   revision, source, cost, and output in the audit history.

## Completion Log

Future implementation chats must append dated entries here after a phase is
verified. Each entry should include the phase, commit, migrations, deployment
versions, test results, credentials still required, and unresolved risks.

### 2026-07-29 - Phase 1 Completed

- Status: completed and verified locally.
- Implementation commit: `ee67ccb`.
- Migration: `drizzle/0002_lyrical_pete_wisdom.sql`.
- Delivered:
  - Project permissions, review gates, output requirements, milestones,
    decisions/assumptions/questions, deliverables, and typed agendas.
  - Durable tasks with dependencies, agent assignment, tool scopes, budgets,
    output schemas, and review requirements.
  - Executive and worker definitions with model routes, capabilities, tool
    scopes, and review policy.
  - Command selection context, command revisions, persisted page drafts, and
    pending clarification restoration across navigation and reloads.
  - Organization/project ownership checks for agenda-linked tasks, records,
    and deliverables.
- APIs: added command retrieval, agent definition listing, agenda task routes,
  and project milestone, record, and deliverable routes.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 30 tests.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - Browser verification passed at 1024x768 and 1440x900 with no horizontal
    overflow; project creation, governance rendering, agenda type selection,
    clarification, contextual page modes, and draft restoration were checked.
- Deployment: not deployed in this phase; Railway migration and production
  smoke tests remain required before release.
- Credentials required: none for Phase 1.
- Remaining risks:
  - Authentication is intentionally deferred; the seeded operator remains the
    only active identity.
  - Workflow planning and worker execution still use the Phase 3
    implementation and are not considered complete by this entry.
  - The production database must run the Phase 1 migration before this commit
    is deployed.

### 2026-07-29 - Phase 2 Completed

- Status: completed and verified locally.
- Implementation commit: `48658aa`.
- Migration: `drizzle/0003_melodic_vision.sql`.
- Delivered:
  - Workspace, project, agenda, and task/run-addressable context layers.
  - Organization-scoped source registry with authority, approval, language,
    expiry, provenance, and SHA-256 content identity.
  - Stable bounded chunks with deduplication, token estimates, source language,
    optional 1536-dimension embeddings, and embedding-route metadata.
  - Persisted context packs and ranked pack items linked to command, run,
    project, agenda, and task.
  - Retrieval scoring for lexical relevance, scope, language, authority, and
    agenda affinity under a hard token budget.
  - Workflow grounding now sends selected cited passages instead of complete
    project histories.
  - REST APIs for context-pack creation and audited pack retrieval.
  - LiteLLM multilingual embedding endpoint support and configurable
    `LITELLM_EMBEDDING_ROUTE`.
  - PostgreSQL `pgvector`, GIN full-text, HNSW vector, and scope indexes.
- Validation:
  - `npm run typecheck` passed after production build.
  - `npm test` passed with 33 tests across 5 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - English, Korean, and mixed-language detection tested.
  - Approved-memory inclusion, proposed-memory exclusion, cross-project
    isolation, chunk deduplication, citations, and pack rereads tested.
  - Live REST smoke passed: project creation `201`, context-pack creation
    `201`, and persisted pack retrieval `200`.
- Deployment: not deployed in this phase; Railway migration and context-pack
  production smoke remain required.
- Credentials required: none for lexical retrieval. Enabling semantic
  embeddings requires a multilingual embedding model configured inside
  LiteLLM; provider credentials remain only on the LiteLLM service.
- Remaining risks:
  - Embedding backfill is not run until a production embedding route is
    configured; lexical multilingual retrieval remains active meanwhile.
  - Existing documents and memory are indexed lazily on context-pack creation,
    not by a dedicated background backfill job.
  - Production PostgreSQL must permit `CREATE EXTENSION vector`.

### 2026-07-29 - Phase 3 Completed

- Status: completed and verified locally.
- Implementation commit: `eabde84`.
- Migration: `drizzle/0004_mysterious_the_enforcers.sql`.
- Delivered:
  - Reusable worker catalog for research, company intelligence, marketing,
    ideation, writing, editing, extraction, enrichment, documents, email
    drafting, translation, and quality review.
  - Strict Zod contracts for executive plans, delegated tasks, worker results,
    findings, artifacts, assumptions, unresolved questions, and review needs.
  - Trigger.dev worker fan-out with stable per-run task idempotency keys,
    retries, concurrency control, cancellation, and terminal failure hooks.
  - Persisted workflow plans, worker runs/attempts/results, workflow
    checkpoints, Trigger run IDs, deadlines, terminal state, and dead letters.
  - Run, project, agenda, and organization budget ledger support with hard
    pre-execution checks and model-cost accumulation.
  - LiteLLM call telemetry for actual model/provider, tokens, cost, latency,
    fallback reason, and errors.
  - Persisted managed-workflow progress and worker activity events.
  - PostgreSQL advisory locks for collision-free event sequencing during
    parallel worker completion.
- Validation:
  - `npm run typecheck` passed after production build.
  - `npm test` passed with 37 tests across 6 files.
  - `npm run build` passed and compiled Trigger workflow contracts/hooks.
  - Drizzle migration generation passed.
  - Worker coverage, structured validation, duplicate task rejection,
    idempotent plan persistence, worker output persistence, project budget
    enforcement, and terminal failure reconciliation tested.
- Deployment: not deployed in this phase; Trigger.dev production upload,
  Railway migration, and managed-run smoke remain required.
- Credentials required: none beyond existing Trigger.dev, LiteLLM, and workflow
  callback configuration.
- Remaining risks:
  - Scheduled workflow templates and approval-token pauses need production
    workflow/UI scenarios before they can be operationally exercised.
  - Tool-call accounting activates when MCP tools arrive in Phase 6; no tool
    invocations exist yet.
  - Provider-reported cost fields vary; production smoke must confirm LiteLLM
    response-cost metadata for configured providers.

### 2026-07-29 - Phase 4 Completed

- Status: completed and verified locally.
- Implementation commit: `1344af9`.
- Migration: `drizzle/0005_regular_ikaris.sql`.
- Delivered:
  - Organization-wide canonical company registry with normalized names and
    domains, legal/trading names, locations, classifications, confidence,
    completeness, research timestamps, and project/agenda links.
  - Globally unique official identifier records for registration IDs, LEI,
    CIK, and future identifier types.
  - Source evidence with retrieval and expiration metadata.
  - Deterministic identity order: official identifier, domain, normalized
    name plus country, then fuzzy candidate requiring review.
  - Durable research campaigns with target, scope, qualification rules,
    required fields, exclusions, source/query plans, existing-record policy,
    cost, estimated remaining population, and saturation reason.
  - Organization-level candidate fingerprints and campaign links preserving
    reusable, stale, incomplete, rejected, duplicate, unresolved, and new
    dispositions across projects.
  - Expiring worker leases protected by PostgreSQL advisory locks so parallel
    workers and retries cannot research one candidate concurrently.
  - Coverage endpoint reporting existing reusable population, eligible count,
    target gap, and explicit market saturation.
  - REST endpoints for company matching/registration, campaign creation,
    candidate intake, coverage, leases, release, and saturation.
  - Canonical research remains separate from client databases. No discovered
    company is written to client data without the later approval workflow.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 41 tests across 7 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - Legal-name/domain normalization, identifier-first reuse, fuzzy review,
    repeated candidate reuse, lease exclusion/release, coverage gaps, and
    saturation reporting tested.
- Deployment: not deployed in this phase; Railway migration and API smoke
  tests remain required.
- Credentials required: none.
- Remaining risks:
  - Fuzzy matching intentionally proposes review rather than merging records;
    richer address and multilingual entity resolution can be added after
    production data establishes useful thresholds.
  - Client-database write proposals and approvals arrive in Phase 8.
  - Campaign orchestration can use these APIs now; provider-specific discovery
    connectors arrive with MCP tools in Phase 6.

### 2026-07-29 - Phase 5 Completed

- Status: completed and verified locally.
- Implementation commit: `bc70ffe`.
- Migration: `drizzle/0006_opposite_nicolaos.sql`.
- Delivered:
  - Durable brand profiles containing audiences, positioning, structured voice,
    approved/prohibited claims, competitors, revision, and approval state.
  - Marketing campaigns linked to projects, agendas, and brand profiles with
    objectives, audiences, positioning alternatives, channels, formats,
    assumptions, success metrics, lifecycle, and approval state.
  - Persistent concepts and channel/format variants with shortlist, approval,
    rejection, and mandatory decision reasoning.
  - Content calendar items linked to campaigns and optional content variants.
  - Brainstorming sessions retaining prompts, evaluation criteria,
    assumptions, alternatives, scores, shortlist/rejection decisions, reasons,
    and final decision summaries.
  - Durable experiment plans linked to campaigns or brainstorming sessions.
  - Editable creative outputs normalized into working reports for briefs,
    campaign plans, calendars, copy, concepts, decision memos, and experiments.
  - Approved brand and campaign context integrated into bounded context packs;
    drafts and rejected material are not treated as authoritative policy.
  - External publication, send, and ad-activation requests create pending
    review records and review-required proposals. No execution endpoint exists.
  - REST APIs for all Phase 5 creation, decision, approval, calendar, output,
    experiment, and external-action proposal flows.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 44 tests across 8 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - Draft-context exclusion, approved-context retrieval, durable concept and
    idea rejection reasons, calendar planning, editable report outputs,
    experiment creation, and review-gated external actions tested.
- Deployment: not deployed in this phase; Railway migration and REST smoke
  remain required.
- Credentials required: none.
- Remaining risks:
  - External action execution remains intentionally absent until MCP provider
    tools and Phase 8 approval-token enforcement exist.
  - Production UI composition for marketing and brainstorming remains part of
    later design/release phases; current surfaces are REST and agent-driven.
  - Calendar entries are internal plans, not connected to external calendar or
    publishing providers.

### 2026-07-29 - Phase 6 Completed

- Status: completed and verified locally.
- Implementation commit: `07a9d98`.
- Migration: `drizzle/0007_worthless_cloak.sql`.
- Delivered:
  - Official MCP TypeScript SDK `1.30.0` with authenticated stateless
    Streamable HTTP transport.
  - Separate `mcp-tools` Express service, Railway Dockerfile, private-network
    URL configuration, health endpoint, and shared service-secret auth.
  - Application MCP host/client for discovery and calls without direct
    coupling between orchestration and provider SDKs.
  - Organization-scoped server, tool, resource, prompt, role/project grant,
    discovery, and invocation registries.
  - Tool governance metadata covering schemas, group, permissions, risk,
    approval requirement, per-tool budget, active state, and health.
  - Project-specific deny precedence over global grants, scoped call limits,
    scoped cost limits, and agent-definition permission derivation.
  - Durable discovery and invocation audits with input, output, status, error,
    duration, cost, run/worker/project scope, and linked review.
  - Sensitive tools pause before transport invocation and resume only against
    a linked approved review.
  - Initial internal tools for workspace search, cited project context,
    approved knowledge, client-data reads, staged client writes, working
    reports, editable documents, Railway storage exports, and canonical
    company matching.
  - Staged client writes never mutate client records.
  - Governance resource and scoped-tool-use prompt exposed through MCP.
  - Explicit extension groups for CRM, calendar, analytics, publishing, ERP,
    accounting, cloud storage, and manufacturing adapters.
  - REST endpoints for role-scoped discovery/calls and protected internal
    server discovery.
- Validation:
  - `npm run typecheck` passed after build.
  - `npm test` passed with 50 tests across 9 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - Real localhost Streamable HTTP discovery verified tool, resource, and
    prompt discovery under bearer authentication.
  - Unauthorized requests, role permission filtering, project deny
    precedence, call limits, budget rejection, invocation failure audit, and
    approval pause/resume tested.
- Deployment: not deployed in this phase. Create a private Railway
  `mcp-tools` service from `railway/mcp-tools/Dockerfile`, set matching
  `MCP_SERVICE_SECRET` values, set `MCP_SERVICE_URL` to Railway private DNS,
  run migration, then execute production discovery smoke.
- Credentials required: generated `MCP_SERVICE_SECRET`; no provider OAuth
  tokens are accepted or forwarded by this service.
- Remaining risks:
  - External provider adapters arrive in later phases and require separate
    provider-specific OAuth/token custody.
  - `npm install` reports 27 vulnerabilities across the full dependency tree.
    Detailed registry audit was not run because sending the local dependency
    manifest externally was not authorized; Phase 12 must resolve or formally
    accept production-relevant findings.
  - Approval decision hardening and one-time approval tokens arrive in Phase 8.

### 2026-07-29 - Phase 7 Completed

- Status: completed and verified locally.
- Implementation commit: `375ef6e`.
- Migration: `drizzle/0008_stale_wendell_rand.sql`.
- Delivered:
  - Organization-scoped provider registry for Tavily, Brave, SEC EDGAR,
    U.S. Census, World Bank, FRED, Korean Public Data Portal, KOSIS, OpenAlex,
    Crossref, Semantic Scholar, Wikimedia, and Wikidata.
  - Provider metadata covering categories, endpoint, credential environment,
    priority, request rate, concurrency, daily limits, cache TTL, cost,
    quality score, policy URL, and structured policy requirements.
  - Policy-aware settings verified against current official documentation:
    SEC identified automation below 10 requests/second, Crossref polite-pool
    contact/caching/rate headers, Wikimedia identified User-Agent and 2026
    rate/Retry-After rules, OpenAlex credits/rate limits, and keyless World
    Bank V2 access.
  - Provider-specific adapters with normalized source output and bounded
    primary/fallback routing.
  - Durable agenda-scoped research queries, query budgets, query counts,
    provider coverage, costs, attempts, HTTP state, backoff, fallback origin,
    duration, and errors.
  - Exponential retry with bounded attempts and `Retry-After` handling for
    `429` and `503` responses.
  - Durable response cache keyed by provider/language/query plus visible
    cache-hit state and source TTL.
  - Normalized evidence containing publisher, title, URL, excerpt, language,
    license, content hash, working citation, confidence, quality, publication
    date, retrieval date, expiry, and evidence state.
  - Original provider evidence stored separately from model summaries.
  - Explicit unavailable, blocked, stale, low-confidence, rate-limited, and
    contradictory states exposed through query status APIs.
  - Durable contradiction records linking all conflicting evidence.
  - Domain policy registry with block/allow controls, API/robots policy mode,
    request limits, reason, and last policy check.
  - New governed MCP `research_sources` tool and REST query/status/
    contradiction endpoints.
- Validation:
  - `npm run typecheck` passed after build.
  - `npm test` passed with 56 tests across 10 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - Provider registration, policy limits, primary outage fallback, original
    evidence retention, citations, cache reuse, `Retry-After`, stale evidence,
    contradiction visibility, source coverage, and domain blocking tested.
- Deployment: not deployed in this phase. Run Railway migration, configure an
  identified production `RESEARCH_USER_AGENT`, then smoke each enabled
  provider under its production quota.
- Credentials required to enable corresponding providers:
  `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `FRED_API_KEY`,
  `CENSUS_API_KEY`, `KOREAN_PUBLIC_DATA_SERVICE_KEY`,
  `KOREAN_PUBLIC_DATA_ENDPOINT`, `KOSIS_API_KEY`, `KOSIS_API_ENDPOINT`, and
  optionally `OPENALEX_API_KEY` and `SEMANTIC_SCHOLAR_API_KEY`.
- Credentials not required for SEC EDGAR, World Bank, Crossref, Wikimedia,
  and Wikidata. Crossref polite access should configure
  `RESEARCH_CONTACT_EMAIL`.
- Remaining risks:
  - Korean Public Data and KOSIS require dataset/statistic-specific endpoint
    selection before calls can run.
  - Live provider response fixtures and quota behavior require production
    credential smoke tests; local tests use contract-faithful mocked responses.
  - Public APIs provide no SLA. Provider state remains visible and bounded
    fallback prevents silent evidence loss.

### 2026-07-29 - Phase 8 Completed

- Status: completed and verified locally.
- Implementation commit: `9aee2cb`.
- Migration: `drizzle/0009_round_black_crow.sql`.
- Delivered:
  - Durable, organization-scoped client change sets linked to projects,
    agendas, runs, destination databases, reviews, and idempotency keys.
  - Insert, update, delete, and merge proposals with exact before/after
    values, changed fields, confidence, validation warnings, duplicate links,
    source evidence IDs, revision, and expiration.
  - Project Command Center review surface with current/proposed comparison,
    per-item selection, proposal editing, rejection, more-research requests,
    JSON export, approval/application, conflict state, and rollback.
  - Fresh one-time approval tokens stored only as hashes and bound to the
    proposal content hash plus exact selected item IDs.
  - Approval invalidation on proposal revision and fresh review submission
    after operator edits.
  - Transactional application guarded by a PostgreSQL advisory lock and
    full-batch optimistic revalidation before any write.
  - Durable application records and exact rollback snapshots for every
    inserted, updated, deleted, or merged record.
  - Direct record POST/DELETE routes blocked; Client & Data record view made
    read-only; record mutations now enter through project proposals.
  - MCP staging upgraded from an ephemeral payload to a durable submitted
    change set. MCP invocation approval and client-data approval remain
    separate controls.
  - Generic review decisions now persist in PostgreSQL and update review
    state instead of existing only in process memory.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 61 tests across 11 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - Proposal idempotency, selective approval, approval invalidation,
    concurrent conflict atomicity, exact rollback, and direct-write blocking
    tested.
- Deployment: not deployed in this phase. Run the Railway migration before
  enabling client-data proposal application in production.
- Credentials required: none.
- Remaining risks:
  - Production PostgreSQL migration and transactional smoke tests remain for
    Phase 12.
  - Bulk proposals should be load-tested against realistic record counts
    before raising the current 1,000-item API limit.

### 2026-07-29 - Phase 9 Completed

- Status: completed and verified locally with mocked Google APIs.
- Implementation commit: `8114feb`.
- Migration: `drizzle/0010_strange_lionheart.sql`.
- Delivered:
  - Google server-side authorization-code flow with offline access, one-time
    hashed state, ten-minute expiration, consent prompt, and exact
    `gmail.readonly` plus `gmail.compose` scopes.
  - AES-256-GCM token encryption using a dedicated
    `GMAIL_TOKEN_ENCRYPTION_KEY`; refresh/access tokens never enter public API
    responses and Gmail credentials remain separate from MCP transport
    authentication.
  - Organization-scoped Gmail connections, mirrored threads, messages,
    attachment metadata, project/client/company links, drafts, and immutable
    draft revisions.
  - Bounded selected-thread search/retrieval and deterministic thread digests
    for Executive Agent context.
  - Attachment import that stores the immutable original in Railway Storage,
    records a content hash and Gmail provenance, converts supported content,
    and creates a project document.
  - Project-linked Gmail draft creation and revision through Gmail's draft
    endpoints with retained local revision history.
  - Governed MCP tools for thread search/retrieval/digest, linking,
    attachment import, draft creation, and draft revision.
  - Explicit approval gates for attachment imports and project links.
  - Gmail Settings surface for connection status, OAuth start, and token
    revocation/disconnect.
  - No API route or MCP tool for sending, forwarding, permanent deletion,
    delegation, or mailbox administration.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 66 tests across 12 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - OAuth scope/offline behavior, state replay prevention, authenticated token
    encryption/tamper rejection, selected-thread retrieval, message and
    attachment mirroring, project linking, attachment provenance, draft
    revision history, and absence of send/delete tools tested.
- Deployment: not deployed in this phase. Register the production redirect
  URL, set Gmail credentials on the Railway app and private MCP service, run
  migration, and complete a real Google consent/search/draft smoke test.
- Credentials required:
  - `GOOGLE_GMAIL_CLIENT_ID`
  - `GOOGLE_GMAIL_CLIENT_SECRET`
  - Generated base64-encoded 32-byte `GMAIL_TOKEN_ENCRYPTION_KEY`
  - Google Workspace administrator approval when organization policy requires
    it
- Remaining risks:
  - Google verification may be required before use outside configured test
    users.
  - Live Gmail quota, token revocation, large attachment, and Workspace policy
    behavior remain production smoke-test items.
  - Sending stays unavailable. A future send capability must use a fresh,
    exact-message approval immediately before execution.

### 2026-07-29 - Phase 10 Completed

- Status: implementation completed and verified locally; private service image
  requires Railway build/runtime smoke testing.
- Implementation commit: `e167cec`.
- Migration: `drizzle/0011_sweet_gabe_jones.sql`.
- Delivered:
  - Immutable original-file upload to Railway Storage before conversion, with
    SHA-256 identity and signed original-file access.
  - Private Railway `document-conversion` service using PyMuPDF, pdfplumber,
    Tesseract English/Korean OCR, page rendering, embedded-image extraction,
    Noto CJK fonts, python-docx, and WeasyPrint.
  - Normalized conversions, pages, blocks, tables, images, bounding boxes,
    extraction method, confidence, language, OCR state, warnings, errors, and
    retry history.
  - Editable Markdown output for digital and scanned PDFs, DOCX, HTML,
    CSV/TSV, JSON, Markdown, and text.
  - Original/Edited/Proposed views in the full-page document surface,
    conversion confidence and warning status, retry control, revision count,
    and explicit extraction approval.
  - Structured LiteLLM repair limited to low-confidence headings, reading
    order, and table structure. AI repair creates an unapproved revision and
    cannot alter authoritative content before operator approval.
  - Immutable document revisions for conversion, manual edits, AI repair, and
    rollback-compatible history.
  - Context retrieval now chunks only the latest approved document revision;
    failed, uncertain, and unapproved extraction stays unavailable to agents.
  - Markdown, DOCX, PDF, and applicable table-to-CSV exports.
  - Gmail attachments now use the same original-preserving document
    intelligence pipeline while retaining Gmail message/attachment provenance.
  - Legacy non-empty documents backfilled as approved revision 1 during
    migration.
  - App health check includes the private document conversion service.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 71 tests across 13 files.
  - `npm run build` passed.
  - Python service source passed `py_compile`.
  - Drizzle migration generation passed.
  - Original-before-conversion ordering, bilingual conversion metadata,
    low-confidence context exclusion, explicit approval, failed-source
    preservation, constrained AI repair, private-service authentication,
    Korean-safe export delegation, Gmail pipeline reuse, and revision
    provenance tested.
- Deployment: not deployed in this phase. Build
  `railway/document-conversion/Dockerfile`, configure its private URL/secret
  and bucket variables, run migration, then smoke digital, scanned,
  table-heavy, English, Korean, and mixed-language fixtures.
- Credentials required: generated `DOCUMENT_CONVERSION_SERVICE_SECRET`; no
  external OCR API key is required.
- Remaining risks:
  - Docker is unavailable in the local environment, so the Python image and
    native OCR/font packages were not executed locally.
  - Tesseract accuracy depends on scan quality; low-confidence pages remain
    review-required by design.
  - Large complex PDFs require production timeout, memory, and concurrency
    load tests in Phase 12.

### 2026-07-29 - Phase 11 Completed

- Status: implementation completed and verified locally; provider credentials
  and live routing require Railway smoke testing.
- Implementation commit: `e58a05d`.
- Migration: `drizzle/0012_breezy_hannibal_king.sql`.
- Delivered:
  - LiteLLM remains the only provider gateway.
  - Role-specific routes for executive reasoning/review, research, creative
    ideation, writing, editing, structured extraction, translation, fast
    classification, multilingual embeddings, and multilingual reranking.
  - Claude Haiku Executive routes, NVIDIA worker routes, and OpenRouter free
    testing fallbacks configured through environment-owned model IDs.
  - Explicit ordered candidates, route cost ceilings, structured-output
    requests and validation telemetry, retries, cooldown/circuit behavior, and
    production approval gates.
  - Free NVIDIA and OpenRouter endpoints are testing-only by default.
    `NVIDIA_PRODUCTION_APPROVED=true` is required after commercial-use,
    retention, privacy, regional, and reliability review.
  - Durable model-call telemetry for actual provider/model, token counts,
    provider cost, latency, fallback reason, errors, attempt count, structured
    output validity, request budget, environment, and licensing status.
  - Read-only model settings API exposing route purpose, candidate order,
    configured model, pricing class, approval status, and active environment.
  - Specialized workflow workers now use specialized model routes.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 77 tests across 14 files.
  - `npm run build` passed.
  - Drizzle migration generation passed.
  - Route coverage, fallback order, production blocking, explicit NVIDIA
    promotion, budget caps, request validation, and worker-route mapping tested.
- Deployment: not deployed in this phase. Add rotated provider credentials and
  full LiteLLM model IDs on Railway, run migration, then exercise primary,
  fallback, budget rejection, invalid structured output, embeddings, and
  reranking against live providers.
- Credentials required:
  - `NVIDIA_API_KEY`
  - Rotated `OPENROUTER_API_KEY`; never reuse the previously exposed key
  - Production fallback provider key when selected
- Remaining risks:
  - Free endpoint availability, quotas, retention, licensing, and model aliases
    can change without notice and require a current provider review.
  - No worker route is production-enabled until NVIDIA is explicitly approved
    or a paid production candidate is configured.
  - Provider-reported cost and fallback metadata require live LiteLLM
    verification.

### 2026-07-29 - Phase 12 Completed

- Status: application implementation completed and verified locally;
  production deployment gates remain open and are documented below.
- Implementation commit: `b98df3a`.
- Completion follow-up commit: `58cbf91`.
- Migrations: `drizzle/0013_melted_franklin_richards.sql` and
  `drizzle/0014_dear_vin_gonzales.sql`.
- Delivered:
  - Persistent per-user interface locale, timezone, date format, number format,
    and currency preferences.
  - Per-project English, Korean, or bilingual output language captured during
    project creation and enforced in Executive planning, worker output, and
    final report prompts while preserving source-language evidence.
  - Korean-capable shell navigation, search and project commands, Korean-safe
    fonts, and immediate locale application without reload.
  - Live Settings model surface showing environment, LiteLLM health, route
    purpose, budget, structured-output policy, ordered candidates, actual
    model IDs, pricing class, approval/licensing state, and latest successful
    call telemetry.
  - Guarded model route revisions with immutable versions, live model tests,
    approval-before-activation, single active revision, history, and rollback.
  - Active model revisions now control application route budgets and candidate
    policy while calls still pass only through LiteLLM.
  - MCP Settings visibility for allowed tools, risk, and approval policy;
    Gmail connection and revocation state remain visible beside it.
  - Shared English/Korean catalog now covers navigation, command surfaces,
    projects, forms, validation messages, notifications, search, Documents,
    Client & Data, Knowledge Base, model governance, MCP, Gmail, report and
    export actions, and all first-use/empty states.
  - Locale-aware dates, numbers, time zones, and currency formatting are
    applied across operational views. Project budgets persist their own USD or
    KRW currency so changing an operator preference cannot relabel stored
    monetary values.
  - Settings now reports configured MCP service health and Gmail OAuth
    readiness. Model route cost and structured-output controls can be staged
    as governed revisions; unsafe production candidate promotion is blocked
    server-side.
  - Model rollback reactivates the prior approved revision rather than leaving
    a route without active policy.
  - Production smoke coverage expanded to model settings, preferences, MCP
    catalog, and document conversion.
  - Railway deployment order, secrets, model approval rules, health gates, and
    end-to-end production smoke checklist documented.
- Validation:
  - `npm run typecheck` passed.
  - `npm test` passed with 82 tests across 16 files.
  - `npm run build` passed with 96 application and API routes.
  - Drizzle migration generation passed.
  - Translation lookup, fallback, interpolation, and catalog coverage are
    tested. Production browser QA must be repeated after deployment.
- Deployment: not deployed in this phase. Run the Railway production gate in
  `railway/README.md`; the app intentionally reports missing providers instead
  of treating them as healthy.
- Credentials required:
  - Phase 11 provider credentials and explicit NVIDIA production approval
  - Existing Railway, Trigger.dev, Gmail, MCP, storage, and conversion secrets
- Remaining production blockers:
  - Live LiteLLM primary/fallback/embedding/reranking, Gmail OAuth, Korean OCR,
    report exports, SSE reconnect, backup/restore, and alert delivery still
    require production acceptance tests with real inputs.
  - Live browser QA in English and Korean remains part of the production gate;
    provider-originated error text and imported source content remain in their
    source language by design.

### 2026-07-29 - Production Deployment Follow-up

- Railway project: `MTI Business OS`
  (`18dcde56-e623-44be-956d-cf5362607f4b`), production environment
  `dda4ceba-aae3-4470-9b04-9763d4cc255f`.
- Deployed application:
  `https://app-production-201e.up.railway.app`.
- Trigger.dev production version `20260729.4` deployed with two detected
  tasks. Deployment: `fhjpfzy3`.
- Provisioned and validated Railway services: `app`, `litellm`, `mcp-tools`,
  `document-conversion`, PostgreSQL, Redis, and `business-os-files`.
- Production migrations and seed completed. Migration ledger contains all 15
  migrations and `projects.budget_currency` is present.
- Production migration repairs:
  - `4eedb52` converts legacy text task assignments to UUID before adding the
    agent foreign key.
  - `d6630c3` enables `pgcrypto` before the document revision SHA-256 backfill.
  - `4d01d15` removes app-only Railway commands from shared config so private
    Docker services use their own startup commands.
- Production `/api/health` returned `ok` for PostgreSQL, Redis, Railway
  Storage, LiteLLM, and document conversion.
- `npm run test:production` passed against the deployed application.
- Local verification remains green: typecheck, production build, and 84 tests
  across 16 files.
- Remaining release gates:
  - Complete English/Korean visual QA at laptop and desktop widths.
  - Exercise current Trigger version with a real Executive command and verify
    worker completion, callbacks, persisted events, SSE reconnect, and cost
    attribution.
  - Exercise live LiteLLM primary/fallback, embedding, and reranking routes.
  - Run authenticated MCP invocation, Korean scanned-PDF conversion and
    export, Gmail OAuth/read/draft, backup restore, and alert-delivery tests.
  - Review and rotate production secrets, and replace any provider key ever
    exposed in chat or logs.
