# MTI Korea AI Business OS - Outstanding Work

## Purpose

`IMPLEMENTATION_PLAN.md` is the historical phase-by-phase build record (Phases
1-13) and stays authoritative for what was built, why, and its detailed spec
for Phase 13 (generalized collection campaigns). This document does not
repeat that detail.

This document is the current punch list: everything identified as broken,
missing, drifted from its own documentation, or planned-but-not-built, as of
the audits run in this session. Read this document to know what to do next,
in priority order. Read `IMPLEMENTATION_PLAN.md` for the full spec of any
item that references a phase number.

## Status tags

- `[OPEN]` - not started, no code written.
- `[PARTIAL]` - some of it exists; a verified gap remains.
- `[PLANNED]` - fully speced elsewhere (usually `IMPLEMENTATION_PLAN.md`
  Phase 13), zero implementation code written.

## How to use this across sessions

1. Read this file top to bottom before starting work.
2. Before marking anything done, verify it the way this session did:
   `npm run typecheck`, `npm test`, `npm run build`, and where the change is
   observable, check it running (browser or curl), not just a clean exit
   code. Section 1.1 exists specifically because a clean build was not
   sufficient evidence there.
3. Move a completed item from this file into `IMPLEMENTATION_PLAN.md`'s
   Completion Log with a dated entry, matching that document's existing
   format, then delete it from here.

---

## 1. Security - open, no code fix landed

### 1.1 Session revocation is not enforced on most API routes `[OPEN]`

**What's wrong:** Logout, admin-initiated session revocation, and the
revocation that should follow a password change all write `revoked_at` to
the `user_sessions` table. Only routes that explicitly call
`currentSession()` (`lib/auth.ts`) check that column - roughly 18 of ~100
routes under `app/api/v1/`. Every other route is protected only by
`middleware.ts`'s Edge-runtime signature+expiry check, which cannot see
`revoked_at`. A stolen or post-logout cookie keeps working on most endpoints
for up to its 12-hour idle window.

**Why it's still open:** The obvious centralized fix - switch `middleware.ts`
to the Node.js runtime so it can query Postgres directly - does not work on
this Next.js version (15.5.22). `middleware.ts`'s exported `config` object is
validated by a `.strict()` Zod schema
(`node_modules/next/dist/build/segment-config/middleware/middleware-config.js`)
that only accepts `matcher`, `regions`, and `unstable_allowDynamic`. Adding
`runtime: "nodejs"` does not switch runtimes - it fails schema validation,
and Next.js silently drops the entire middleware with no build error.
Verified empirically: `.next/server/middleware-manifest.json` was `{}` after
that change, `tsc --noEmit` and `next build` both exited 0. This is recorded
in memory (`nextjs_middleware_runtime_gotcha.md`) - reread it before
re-attempting a middleware-runtime fix, and confirm the manifest is
non-empty after any change to `middleware.ts`, not just a clean build.

**Options, in recommended order:**

1. **Centralized wrapper, applied to every route (recommended).** Add
   `requireSession(handler)` / `requireSession(handler, { admin: true })` to
   `lib/auth.ts`, wrapping `currentSession()` around a route handler. Apply
   it as the first line of every exported HTTP method in every route under
   `app/api/v1/` except the ones already public
   (`app/api/v1/auth/login`) or internal-secret-gated
   (`app/api/internal/**`, which uses `WORKFLOW_CALLBACK_SECRET` correctly
   already). This is still ~80 file edits, but centralizing the check into
   one function makes it auditable - a follow-up grep for routes that import
   `requireSession` versus routes that don't becomes the verification step,
   rather than re-reading 80 files by hand each time.
2. **Upstash Redis revocation cache, checked from Edge middleware.** Keep
   Edge middleware, add a cheap `fetch`-based check (Upstash's REST API is
   Edge-compatible; the existing `ioredis`/`REDIS_URL` setup in `lib/redis.ts`
   is not - it needs a TCP socket) against a `revoked:<sessionId>` key
   written on logout/revoke/password-change. Restores centralized
   enforcement without touching every route, but adds a new provisioned
   dependency (Upstash) and a second source of truth to keep in sync with
   Postgres's `revoked_at`. Worth it only if the team wants to avoid the
   80-file edit and is willing to provision and pay for Upstash.
3. **Do not** re-attempt Node.js runtime middleware on this Next.js version
   without first confirming (via a Next.js changelog or a fresh empirical
   manifest check) that the `config` schema has changed.

**Acceptance:** A revoked or logged-out session's cookie is rejected by every
route that reads or writes project, document, client, or knowledge data
within one request of revocation - not just the 18 routes that already call
`currentSession()`.

---

## 2. Documentation-vs-reality drift - found this session, not yet fixed

### 2.1 Executive Command under-attaches page context `[PARTIAL]` (Phase 1)

**What's wrong:** Phase 1's spec claims Executive Command "attaches the
current page, project, selected records, document, knowledge entry, and
client database when relevant." `CommandContext` (`lib/domain.ts`) has fields
for all of that: `agendaId`, `knowledgeEntryId`, `clientDatabaseId`,
`selectedRecordIds`. `submitCommand` in `components/business-os.tsx` (around
line 236) only ever populates `page`, `projectId`, and `documentId`. Open the
Knowledge Base or Client & Data page, select or open something, and the
command context sent to the backend has no reference to it - the model plans
against `page: "knowledge"` with nothing about which entry was open.

**What to do:** Track "currently selected/open" state per page the same way
`focusDocumentId` already does for Documents - a selected knowledge entry ID
in `KnowledgeView`, selected client-database ID and row IDs in
`ClientDataView`, lifted to `BusinessOS` state the same way `focusDocumentId`
is, and included in the `context` object `submitCommand` sends.

**Acceptance:** Selecting a knowledge entry or client-database record, then
issuing a command, results in `CommandContext.knowledgeEntryId` /
`clientDatabaseId` / `selectedRecordIds` being populated and visible in the
persisted `commands.context` column.

### 2.2 No test call before activating a model route revision `[OPEN]` (Phase 12)

**What's wrong:** Phase 12 claims "guarded model-route edits with
validation, a test call, approval, version history, activation, and
rollback." Version history, activation, and rollback are real
(`listModelRouteRevisions` / `setModelRevisionState` in `lib/settings.ts`,
`/api/v1/settings/models/revisions` routes). No code anywhere calls a model
before a revision can be activated - grepped the settings routes and the
Settings UI in `components/business-os.tsx`, nothing. An admin can activate
a revision with a broken model identifier or wrong provider and find out
only when it fails in production.

**What to do:** Add a `POST /api/v1/settings/models/revisions/[revisionId]/test`
route that runs one real `requestLiteLLM` call against the revision's
configuration with a fixed, cheap prompt, and surfaces latency, the actual
model/provider the gateway resolved, and any error. Gate `setModelRevisionState`
transitioning a revision to `active` behind having a recorded successful test
call, the same way `resolveApproval` gates tool execution on `reviews.status
=== "approved"` elsewhere in this codebase.

**Acceptance:** Activating a model route revision that has never had a
successful test call is rejected by the API, not just discouraged in the UI.

---

## 3. Localization gap - known, not fixed

### 3.1 47 UI strings have no Korean translation `[OPEN]`

**What's wrong:** `lib/i18n.tsx`'s `ko` dictionary has 241 keys; 218 distinct
`t()` call sites exist across `components/*.tsx` and `app/**/*.tsx`; 47 of
those calls fall through to the English fallback. Concentrated in the
document editor (`Edit`, `Done`, `Heading 1`-`4`, `Folder`, `Choose files`)
and a handful of settings/search strings. Fallback is graceful - the app
never crashes or shows a raw key - but a Korean-speaking operator sees
English exactly where they work most (editing documents).

**What to do:** Run the same audit script used to find the gap (regex for
`(?<![A-Za-z0-9_$.])t\(\s*"((?:[^"\\]|\\.)+)"` across component files, diff
against `ko` dictionary keys) and add the missing 47 entries. Not
architectural work - translation content only.

**Acceptance:** The same audit script reports zero missing keys.

---

## 4. Performance / scaling watch items

### 4.1 Project activity stream still polls every second `[OPEN]`

**What's wrong:** `lib/sse.ts`'s `pollingEventStream` polls the repository
every ~1s per open connection. Fine for one operator watching one project.
With several projects open across several viewers it becomes a database
query per second per viewer - not urgent, but worth fixing before it's
load-bearing rather than after.

**What to do:** Move to Postgres `LISTEN/NOTIFY` (trigger a `NOTIFY` on
`run_events` insert, have the SSE route `LISTEN` instead of polling) or
Redis pub/sub (`lib/redis.ts` already exists) if `LISTEN/NOTIFY` proves
awkward under the connection-pooled `postgres.js` client in `lib/db/client.ts`.

**Acceptance:** No fixed-interval polling loop in the activity-stream path;
new events reach connected viewers within roughly the same latency as today
without a query running once per second regardless of activity.

---

## 5. New capability - generalized collection-research projects `[PLANNED]`

Full spec: `IMPLEMENTATION_PLAN.md` Phase 13. Summary only, so this document
stays a complete map of outstanding work without duplicating 150 lines.

**What it's for:** Today, an instruction like "find 100 companies matching
X, one document each, presented as a database" produces one narrative
report - no database rows, no linked documents. The subsystems needed to do
this for real (`lib/company-research.ts`'s campaign/candidate/claim-lease
system, the MCP tool platform, the research provider catalog) are each built
and tested in isolation but never connected to the executive-agent workflow,
which still runs a fixed ≤20-task pipeline with exactly one non-tool-using
model call per task.

**Harness decision already made (do not re-litigate without new
information):** hand-roll a bounded tool-calling loop directly inside the
existing Trigger.dev task, over native OpenAI-compatible tool-calling passed
through LiteLLM. Not adopting LangGraph, Mastra, the OpenAI Agents SDK, or
CrewAI - see Phase 13's comparison table in `IMPLEMENTATION_PLAN.md` for the
reasoning per option. Vercel AI SDK is the documented fallback if the
hand-rolled loop's complexity grows (streaming, multi-turn UI, parallel tool
calls within one step).

**Named pipeline stages (full detail, including the tool table, in
`IMPLEMENTATION_PLAN.md` Phase 13 - "Named Pipeline Stages"). Stage 0-1 are
foundation, built once. Stage 2-6 are the flow that runs per project and
adapts itself to whatever entity type the user describes. Guardrails is
cross-cutting, not a step in the sequence.**

| Stage | Name | Old ID | Status | One line | Primary tool |
| --- | --- | --- | --- | --- | --- |
| 0 - Foundation | Tool Bridge | 13.0 | Built | Model can call a tool mid-task, not just return one blob | LiteLLM `tools` param |
| 1 - Foundation | Generic Ledger | 13.1 | Built | Schema-agnostic storage for any entity type | Postgres, `pg_advisory_xact_lock` |
| 2 - Flow | Blueprint | 13.2 | Built | Infers this project's schema/template/dedupe key/stop rule | `executive_reasoning` |
| 3 - Flow | Scouting Loop | 13.3 | Built | Discovers and dedupes candidates until saturated | `worker_structured` + Tavily/Brave via MCP |
| 4 - Flow | Dossier Loop | 13.4 | Built | Per-candidate: claim, research, write document, in parallel | Trigger `batchTriggerAndWait`, `claimCollectionCandidate`, `worker_structured` then `worker_writing` |
| 5 - Flow | Cross-Link | 13.5 | Built | Connects the record row to its document | `repository.createDocument`, Phase 8 staged-change flow |
| 6 - Flow | Surface | 13.6 | Built, unverified in browser | "View report" from the database row | `client-data-view.tsx`, existing `DocumentsView` modal |
| Cross-cutting | Guardrails | 13.7 | Built | Keeps Stage 3/4 bounded in cost and time | `clampCostCeiling`, step counters |

### What "Built" means here, and what is still missing

Every stage above passes typecheck, the unit suite (160 tests), and a clean
production build. **None of it has run against a live Postgres, LiteLLM, or
MCP provider** - this session had no `DATABASE_URL` or `LITELLM_BASE_URL`, so
all verification is deterministic code paths with mocked models and the
in-memory store. Outstanding before this is production-ready:

- **A staging smoke test of one real campaign, end to end.** This is the
  single most valuable next step and nothing above substitutes for it.
- **Migrations `0018` and `0019` are generated but not applied.**
- **Stage 6 has never been clicked.** The "View report" button typechecks and
  builds but no one has seen it render; it needs a signed-in browser pass.
- **The eval harness below still does not exist**, so no change to any of
  these prompts can be judged against anything but a manual spot-check.

Where a stage depends on something downstream that is not built, the code
says so in a run event rather than implying success - that pattern should be
preserved as the remaining gaps close.

### Guardrails as built

Three independent bounds, because they fail differently:

| Bound | Value | Where |
| --- | --- | --- |
| Discovery steps | 15 model rounds | `MAX_STEPS`, `trigger/collection-agent.ts` |
| Searches per dossier | 4 | `DOSSIER_SEARCH_STEPS`, same file |
| Candidates researched per run | 100 | `DOSSIER_FANOUT_LIMIT`, `app/api/internal/workflow/route.ts` |
| Campaign spend | 500 cents, clamped down by the project's budget | `CAMPAIGN_DEFAULT_CEILING_CENTS`, `lib/collection-research.ts` |

The spend ceiling reads `runs.cost_micros` - the same running total the budget
ledger derives from - and clamps through the same `clampCostCeiling` the MCP
layer uses, so there is one clamping rule rather than two that can disagree.
A project budget can only tighten a campaign's ceiling, never raise it.

Two deliberate choices worth keeping:

- **The budget check fails closed.** If spend cannot be read, work stops and
  the reason says so. Continuing would mean spending money that can no longer
  be accounted for.
- **Stopping reasons are never conflated.** Saturation, a step-cap cutoff, and
  a budget cutoff are three different facts recorded three different ways;
  only saturation marks a campaign done. The same applies per candidate -
  `budget_exhausted` is reported separately from `failed`, because the user's
  response differs (raise the ceiling vs. investigate).

**Recommended prerequisite before building this:** an eval harness. There is
currently no automated way to tell whether a change to how a worker
reasons (which this entire phase is) made output better or worse - all 97
existing tests assert deterministic code paths, none assert model output
quality. Concretely: a fixture set of roughly 20 golden instructions per
model route that matters most (`worker_research`, `worker_structured`,
`worker_writing`), each with a rubric, graded by a separate `executive_review`-style
judging call, run via a new `npm run eval` script, with results stored
somewhere reviewable (a table, or a report file per run) rather than only a
pass/fail. This does not need to be exhaustive to be useful - it needs to
exist before Phase 13 ships, so a change to the discovery loop's prompt can
be judged against something other than one manual spot-check.

---

## 6. Suggested execution order

1. **1.1 Session revocation** - highest severity, smallest reasoning risk
   (the wrapper approach is mechanical once written), directly affects real
   client data.
2. **Eval harness** (documented under Section 5, not its own numbered item
   above because it has no existing phase number yet - give it one when it's
   speced in enough detail to become a phase) - needed before Phase 13 can
   be trusted, cheap relative to everything else here.
3. **2.2 Model revision test call** - small, self-contained, prevents a
   future admin from silently breaking a model route.
4. **Phase 13** (Section 5) - **all stages now written; the remaining work is
   verification, not construction.** In order: apply migrations `0018`/`0019`,
   run one real campaign end to end on staging against a live LiteLLM and
   Postgres, then click through Stage 6 signed in. Treat the staging run as
   the gate - the unit suite proves the control flow, not that the pipeline
   works.
5. **2.1 Command context attachment** - moderate size, no dependency on
   anything else here, can be done any time.
6. **3.1 Korean translations** - no architectural dependency, cheapest item
   in this document, fine to batch with anything else or hand off
   separately.
7. **4.1 LISTEN/NOTIFY** - lowest urgency, do when activity-stream load
   actually becomes a concern, not preemptively.
