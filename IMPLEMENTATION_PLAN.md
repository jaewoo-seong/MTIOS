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
- Commit: Phase 1 implementation commit recorded in Git history; exact hash is
  appended by the follow-up completion-log commit.
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
