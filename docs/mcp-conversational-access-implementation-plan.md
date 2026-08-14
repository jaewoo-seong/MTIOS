# MCP Conversational Access — Implementation Handoff

## Purpose

Build a secure external MCP interface for MTI Business OS so ChatGPT, Claude, Gemini, and other MCP-capable clients can use Business OS from an existing conversation without requiring the operator to open the website.

This first implementation is intentionally limited to the operator's current ideas:

1. Turn a conversation or new research idea into a draft research project.
2. Start an approved project from the conversational client.
3. Retrieve project, company, dossier, document, and evidence information conversationally.
4. Analyze information from one or multiple projects.
5. Create and save a complete report based on one or multiple projects.

External research injection and the five later brainstorming ideas are out of scope for this branch.

## Product model

Business OS remains the system of record. The conversational client is a control and retrieval surface.

```text
ChatGPT / Claude / Gemini
          |
          | MCP over authenticated HTTPS
          v
MTI Business OS MCP server
          |
          +--> Projects and research strategies
          +--> One client database per research project
          +--> Company records
          +--> One required primary dossier per published company
          +--> Zero or more supporting documents
          +--> Evidence and citations
          +--> Cross-project reports
```

MCP clients must never receive database credentials, Railway credentials, provider API keys, or unrestricted internal-service credentials.

## Existing code to reuse

Before adding new infrastructure, inspect and extend these existing surfaces:

- `services/mcp-tools/server.ts` — standalone MCP service.
- `lib/mcp/platform.ts` — MCP tool discovery and invocation logic.
- `app/api/v1/mcp/tools/route.ts` — authenticated tool catalog endpoint.
- `app/api/v1/mcp/invoke/route.ts` — authenticated invocation endpoint.
- `lib/research-workspace.ts` — project setup, strategy proposal, activation, and dossier revisions.
- `lib/collection-research.ts` — campaigns, candidates, dossiers, publication, and company linking.
- `lib/repository.ts` — project, document, database, and agent repository operations.
- `lib/db/schema.ts` — existing entities, relationships, credentials, audits, and usage records.
- `lib/api/guard.ts` and `lib/auth.ts` — application authorization patterns.
- `trigger/research-discovery.ts`, `trigger/research-dispatcher.ts`, and `trigger/collection-agent.ts` — current research workflow.

Do not build a second research pipeline inside MCP. MCP tools must call the same domain functions and workflows used by the website.

## Required user journeys

### Journey A — Create a project from a conversation

The operator says:

> Turn this discussion about Korean battery recycling companies into a new research project.

The client summarizes only the relevant conversation context and calls `draft_research_project`. Business OS creates a project draft and proposed strategy, but does not start paid research.

The tool returns:

- Project ID and URL.
- Draft strategy version ID.
- Objective, geography, industries, qualification rules, exclusions, source plan, dossier blueprint, and target count.
- Warnings or clarification questions.
- A clear `requiresApproval: true` signal.

The client then displays the proposal. After the operator explicitly approves it, the client calls `activate_research_project` with the project and strategy IDs.

### Journey B — Retrieve research conversationally

The operator asks:

> What did we find about manufacturers expanding in Busan?

The client calls `search_business_os`, optionally followed by focused read tools. Results include short excerpts, stable IDs, project/company/document relationships, citation metadata, and links back to Business OS.

The MCP server must return bounded results instead of dumping entire projects into the conversation.

### Journey C — Analyze several projects

The operator asks:

> Compare hiring and expansion signals across these three projects.

The client resolves project IDs, retrieves structured company/evidence summaries, performs the analysis, and clearly distinguishes sourced Business OS facts from model inference.

The analysis may remain in the conversation or be saved using `create_cross_project_report`.

### Journey D — Generate and save a full report

The operator asks:

> Make one executive report from the battery, robotics, and manufacturing projects.

The client calls `create_cross_project_report`. Business OS gathers the approved source material, runs the governed report-generation route, saves the result as a document, records its source project IDs, and returns the document URL and citation summary.

## Initial MCP tool set

Implement the smallest tool set that covers the four journeys.

### 1. `list_research_projects`

Read-only. Lists projects visible to the MCP credential.

Input:

```json
{
  "status": "active",
  "query": "optional text filter",
  "limit": 20,
  "cursor": null
}
```

Output includes ID, name, objective, status, active strategy version, company count, dossier count, last activity, and Business OS URL.

### 2. `get_research_project`

Read-only. Returns one bounded project overview.

Input:

```json
{
  "projectId": "uuid",
  "include": ["strategy", "status", "counts"]
}
```

Do not include every company or full dossier in this response.

### 3. `draft_research_project`

Write operation. Creates a project draft and proposed strategy but does not activate research.

Input:

```json
{
  "title": "Korean battery recycling opportunities",
  "objective": "Identify companies likely to need MTI market-entry support.",
  "conversationSummary": "Only the relevant research context from the conversation.",
  "geographyHints": ["South Korea"],
  "industryHints": ["Battery recycling"],
  "researchQuestions": ["Which companies are expanding?"],
  "targetCompanyCount": 25,
  "idempotencyKey": "client-generated-stable-key"
}
```

Rules:

- Require a nonempty title, objective, and idempotency key.
- Limit conversation summary and question lengths.
- Reject raw secrets or obviously oversized conversation dumps.
- Reuse `ensureResearchProject` and `proposeResearchStrategy`.
- Return a proposal requiring explicit activation.

### 4. `activate_research_project`

High-impact write operation. Activates an existing proposed strategy and starts the normal research pipeline.

Input:

```json
{
  "projectId": "uuid",
  "strategyVersionId": "uuid",
  "confirmation": "I approve starting this research project.",
  "idempotencyKey": "client-generated-stable-key"
}
```

Rules:

- Require a credential with `research:execute`.
- Require explicit confirmation text or an MCP-client elicitation/approval result.
- Never combine draft and activation in one tool call.
- Enforce existing project budgets, worker limits, and provider quotas.
- Return run state and project URL rather than waiting for completion.

### 5. `search_business_os`

Read-only federated retrieval across projects, company records, dossiers, documents, and evidence.

Input:

```json
{
  "query": "Busan manufacturers with recent expansion signals",
  "projectIds": ["optional-uuid"],
  "kinds": ["company", "dossier", "document", "evidence"],
  "limit": 10,
  "cursor": null
}
```

Output rules:

- Return concise excerpts and structured metadata.
- Include source IDs, project IDs, company IDs, document IDs, URLs, dates, and confidence where available.
- Include Business OS deep links.
- Never return secret fields, private integration tokens, or hidden system prompts.
- Apply organization/project authorization before semantic or lexical retrieval.

### 6. `get_company_research`

Read-only focused retrieval for a company.

Input:

```json
{
  "companyId": "uuid",
  "include": ["record", "primary_dossier", "supporting_documents", "evidence_summary"]
}
```

Rules:

- Return exactly one primary dossier when published.
- Return supporting documents as metadata by default; full content requires explicit document retrieval.
- Clearly indicate missing required dossiers or unresolved evidence gaps.

### 7. `get_document`

Read-only. Retrieves a bounded document or dossier.

Input:

```json
{
  "documentId": "uuid",
  "format": "markdown",
  "maxCharacters": 30000
}
```

Return revision, approval state, source relationships, and truncation information.

### 8. `create_cross_project_report`

Write and model-cost operation. Produces a governed report and saves it in Business OS.

Input:

```json
{
  "title": "Korean industrial opportunity report",
  "projectIds": ["uuid-1", "uuid-2"],
  "objective": "Compare expansion, hiring, and market-entry signals.",
  "sections": ["Executive summary", "Priority companies", "Cross-project findings", "Evidence gaps"],
  "evidencePolicy": "approved_dossiers_only",
  "idempotencyKey": "client-generated-stable-key"
}
```

Rules:

- Require `reports:create` and explicit confirmation because this spends model tokens.
- Default to approved dossiers and evidence.
- Every material claim must have an adjacent citation.
- Record all source project, company, dossier, and evidence IDs.
- Save the report as a Business OS document rather than returning only transient text.
- Return the report document ID, URL, status, and source coverage.

## Authentication and authorization

### Credential model

Create dedicated external MCP credentials. Do not reuse `MCP_SERVICE_SECRET`, session cookies, or provider API keys.

Recommended credential format:

```text
mti_mcp_<public-prefix>_<secret>
```

Store:

- Credential ID.
- Organization ID.
- Label and optional external client name.
- SHA-256 or Argon2 hash of the secret.
- Public prefix for lookup.
- Scopes.
- Optional allowed project IDs.
- Created, last-used, expiry, rotation, and revocation timestamps.
- Creator user ID.

Show the plaintext secret exactly once.

### Initial scopes

```text
projects:read
companies:read
documents:read
evidence:read
projects:draft
research:execute
reports:create
```

Avoid delete, settings, credentials, user administration, provider administration, and direct database mutation scopes in version one.

### Authorization behavior

- Authenticate every MCP request.
- Resolve the organization and project allowlist before invoking tools.
- Apply scope checks again inside each domain operation, not only at tool discovery.
- Filter the tool catalog so clients only see tools their credential can invoke.
- Rate-limit by credential and organization.
- Audit successful and failed calls without logging secret values or full sensitive payloads.

## Data and schema changes

Add migrations only after inspecting existing credential/audit tables for reuse.

Likely additions:

### `mcp_external_credentials`

- `id`
- `organization_id`
- `created_by_user_id`
- `label`
- `client_name`
- `public_prefix`
- `secret_hash`
- `scopes` JSON or text array
- `allowed_project_ids` JSON or join table
- `status`
- `expires_at`
- `last_used_at`
- `revoked_at`
- timestamps

### `mcp_invocations`

- `id`
- `organization_id`
- `credential_id`
- `tool_name`
- `project_id` where applicable
- `idempotency_key`
- `request_hash`
- `status`
- `duration_ms`
- `result_summary`
- `error_code`
- timestamps

Use a unique index on credential ID plus idempotency key for write operations.

### Cross-project report provenance

Prefer a normalized join table if the existing document/project relationship only permits one project:

- `document_id`
- `source_project_id`
- optional `source_company_id`
- optional `source_document_id`
- relationship type

The report itself can live in a Reports folder while retaining all source relationships.

## MCP transport and deployment

Use authenticated Streamable HTTP over HTTPS. Keep the MCP service independently deployable but reuse application domain code.

Recommended Railway shape:

```text
Internet MCP client
      |
      v
Public MCP service endpoint
      |
      | Railway private network + service credential
      v
Business OS app / PostgreSQL / Trigger.dev workflows
```

Requirements:

- A stable public HTTPS MCP URL.
- Strict CORS/origin handling where applicable, without relying on CORS as authentication.
- Request and response size limits.
- Timeouts for read operations.
- Asynchronous job responses for research activation and report generation.
- Health endpoint that does not reveal configuration secrets.
- Private Railway endpoints for MCP-to-app calls to avoid unnecessary public egress.

## Conversation-context policy

The MCP server does not automatically receive the full ChatGPT, Claude, or Gemini conversation. The client chooses arguments to send.

Rules:

- Accept a short `conversationSummary`, not an unlimited transcript.
- Tell clients to omit unrelated personal, financial, credential, or confidential conversation content.
- Store the summary as project provenance, separate from the approved research strategy.
- Record the external client and invocation ID.
- Never treat conversation text as authorization to start research; activation remains a separate confirmed call.

## Analysis responsibility

Version one supports two analysis paths:

1. **Client-side conversational analysis:** MCP returns bounded, cited evidence and the external assistant analyzes it in the conversation.
2. **Business OS saved reports:** `create_cross_project_report` uses the governed Business OS model route and saves a traceable document.

Do not add a generic `run_any_prompt` tool. Tools should have narrow schemas and predictable authorization/cost behavior.

## Implementation phases

### Phase 0 — Confirm architecture and contracts

- Audit the existing MCP server and tool registry.
- Map each proposed tool to existing domain functions.
- Confirm the current project-to-database, company-to-dossier, and document provenance schema.
- Write Zod schemas and example outputs before implementation.
- Decide whether MCP invokes domain functions directly or calls authenticated internal API routes. Prefer one consistent boundary.

Exit criteria: reviewed tool contracts and no duplicate business logic.

### Phase 1 — External MCP credentials

- Add credential and invocation migrations.
- Implement credential creation, one-time display, listing, rotation, and revocation for admins.
- Implement Bearer-token authentication, scopes, project allowlists, expiry, and rate limits.
- Add redacted audit logs.
- Add an admin UI section only if needed after the API is complete.

Exit criteria: a revoked or out-of-scope token cannot discover or invoke protected tools.

### Phase 2 — Read-only retrieval MCP

- Implement `list_research_projects`.
- Implement `get_research_project`.
- Implement `search_business_os`.
- Implement `get_company_research`.
- Implement `get_document`.
- Add pagination, result limits, truncation markers, and Business OS deep links.
- Add citation and provenance fields.

Exit criteria: ChatGPT/Claude/Gemini can answer project questions without receiving unrestricted database content.

### Phase 3 — Draft and activate projects

- Implement `draft_research_project` using the current project and strategy functions.
- Add idempotency and duplicate-title/duplicate-request handling.
- Implement `activate_research_project` as a distinct confirmed operation.
- Trigger the current dispatcher/discovery pipeline.
- Return asynchronous run state.

Exit criteria: a conversation can safely produce a draft, show it for approval, then launch exactly one research run.

### Phase 4 — Cross-project reports

- Add report provenance relationships.
- Implement source selection and context-size controls.
- Implement `create_cross_project_report` with approved-dossier defaults.
- Save report documents with adjacent citations and source coverage.
- Return report status and deep link.

Exit criteria: one request can create a traceable report from several authorized projects without silently using unapproved material.

### Phase 5 — Client setup and production hardening

- Document ChatGPT, Claude, and Gemini MCP connection examples based on their currently supported configuration formats.
- Add conformance tests against at least two MCP clients.
- Add load, timeout, rate-limit, revocation, and malformed-payload tests.
- Add metrics for calls, latency, failures, model cost, and result truncation.
- Run a security review before production exposure.

Exit criteria: production endpoint, operator runbook, revocation procedure, and verified client connections.

## Test plan

### Unit tests

- Tool input/output schemas.
- Scope and project-allowlist decisions.
- Credential hashing and lookup.
- Idempotency behavior.
- Result truncation and pagination.
- Deep-link generation.
- Conversation-summary limits.
- Citation/provenance serialization.

### Integration tests

- Tool discovery with different scopes.
- Authentication failure, expiry, and revocation.
- Read isolation between projects.
- Draft project creates exactly one project and strategy proposal.
- Repeated draft/activation/report calls with the same idempotency key do not duplicate work.
- Activation starts the existing workflow rather than a parallel MCP-only workflow.
- Cross-project reports reject unauthorized project IDs.
- Saved reports retain all source relationships.

### End-to-end scenarios

1. Connect an MCP client with read-only credentials and retrieve a dossier.
2. Attempt a write with read-only credentials and verify denial.
3. Draft a project from a conversation summary.
4. Activate the approved strategy and observe the normal project status.
5. Retrieve findings after research progresses.
6. Create a report from two projects and open it in Business OS.
7. Revoke the credential and confirm the next request fails.

### Security tests

- Secret values never appear in tool responses or logs.
- SQL/semantic search is organization- and project-scoped before retrieval.
- Prompt injection in stored documents cannot expand tool permissions.
- Oversized inputs and outputs are rejected or truncated.
- Tool names cannot be used to invoke unregistered internal functions.
- Internal URLs and stack traces are not exposed.
- Write tools require scopes, idempotency, and the required approval signal.

## Non-goals for the first branch

- No external agent submission of new companies, evidence, or dossier revisions.
- No provider API-key management through MCP.
- No user, permission, or Railway administration.
- No deletion tools.
- No email or external communication tools.
- No arbitrary SQL, arbitrary internal API calls, or generic shell execution.
- No automatic import of complete conversation histories.
- No CLI-subscription-token reuse for Claude, Gemini, or OpenAI.
- No replacement of the existing website; MCP is an additional interface.

## Main risks and mitigations

### Accidental expensive execution

Mitigation: draft and activation are separate tools; execution requires scope, explicit confirmation, budgets, and idempotency.

### Cross-project or cross-organization leakage

Mitigation: resolve authorization before search, filter every query at the database level, and test project allowlists.

### Duplicate projects and reports

Mitigation: required idempotency keys and unique invocation constraints.

### Hallucinated or unsupported reports

Mitigation: approved-source defaults, adjacent citations, source coverage, and saved provenance.

### Oversharing conversation content

Mitigation: bounded summaries, client guidance, validation, and separate provenance storage.

### MCP credentials becoming master keys

Mitigation: narrow scopes, optional project allowlists, expiration, rotation, revocation, rate limits, and audits.

## Definition of done

- External MCP credentials can be created, scoped, rotated, and revoked.
- At least one external MCP client can connect over HTTPS.
- Read tools retrieve authorized projects, companies, dossiers, documents, and evidence with citations and deep links.
- A conversation can create a project draft without starting research.
- Explicit activation starts the existing research pipeline once.
- Cross-project reports are saved as documents with full provenance.
- Every invocation is audited without secret leakage.
- Full unit, integration, end-to-end, and security tests pass.
- Deployment and client-connection documentation is complete.

## Suggested branch and first task

Suggested branch:

```text
codex/mcp-conversational-access
```

Start the new conversation with:

> Read `docs/mcp-conversational-access-implementation-plan.md` completely. Create or switch to branch `codex/mcp-conversational-access`. Begin with Phase 0 only: audit the existing MCP implementation and database relationships, then propose the exact tool contracts and migration plan. Do not implement later phases until the Phase 0 design is consistent with the existing domain functions.

## Decisions to confirm during Phase 0

1. Should external MCP credentials initially be organization-wide or project-restricted by default?
2. Should `create_cross_project_report` run immediately after confirmation or create a queued report proposal first?
3. Should draft projects appear in the main Projects list immediately or in a separate Drafts view?
4. Which approved material may cross-project reports use: approved dossiers only, or approved dossiers plus raw evidence?
5. What is the maximum conversation-summary size the product should retain?

