# Phase 3 — Conversational projects and brainstorming

## External assistant communication model

Business OS communicates an external assistant's role in three MCP-native ways:

1. Server initialization instructions explain that Business OS is the system of
   record and that the external model is a collaborative reasoning surface, not
   an internal autonomous agent.
2. `mti://external-assistant-role` exposes those responsibilities and limits as
   a discoverable resource.
3. `get_project_briefing` returns bounded MTI organization context, one
   authorized project, its strategy and constraints, and safe descriptions of
   the active internal Business OS agents.

Clients that support MCP prompts also receive `brainstorm_project`. It loads the
briefing and asks the external assistant to produce distinct ideas with rationale,
MTI/project fit, assumptions, evidence needs, risks, and a next step. Clients
that do not surface prompts can call `get_project_briefing` directly and use the
same information in an ordinary conversation.

Brainstorming is read-only and happens in the external conversation. Ideas are
not silently saved, treated as evidence, or approved. A future save-ideas tool
should be a separate explicit write rather than changing this behavior.

## Organization context

The organization name is always returned. Approved organization knowledge is
returned only when the credential has `organization:read`. If no approved MTI
company-profile knowledge exists, the briefing warns the assistant not to invent
MTI capabilities or positioning. Administrators should maintain an approved,
bounded company-profile knowledge entry before enabling organization-aware
brainstorming.

## Draft flow

`draft_research_project` requires `projects:draft` and:

- accepts a maximum 12,000-character conversation summary;
- rejects common credential/private-key patterns;
- creates the project with actual `draft` status;
- keeps conversation provenance separate from the strategy approval record;
- calls the existing premium strategy proposal function;
- automatically adds a newly created project to a selected-project credential;
- returns the proposed strategy with `requiresApproval: true`;
- never dispatches research.

The idempotency ledger stores the durable project ID and completed response.
Repeating the same credential/tool/key/payload returns the original result.
Reusing a key for a different payload fails, and a stale interrupted invocation
can safely resume without deliberately creating a second project.

## Activation flow

`activate_research_project` requires `research:execute`, an authorized project,
the exact confirmation text, and an idempotency key. It:

1. activates the selected proposed strategy using the website's domain function;
2. changes a draft project to active;
3. creates or updates the normal campaign and agenda;
4. dispatches the existing discovery and dossier workflows with deterministic
   Trigger.dev idempotency keys;
5. returns immediately with queued/active state.

Draft and activation remain separate MCP calls. Conversation language is never
interpreted as research approval.

## Schema and deployment

Migration `0030_young_cargill.sql` adds:

- `draft` to `project_status`;
- safe agent descriptions;
- replayable write responses on external invocation records;
- `mcp_project_origins` for bounded external-conversation provenance.

Apply migrations 0029 and 0030 and run the normal seed before enabling Phase 3
tools. Grant only the scopes each connection needs. A brainstorming-only client
normally needs `projects:read`; add `organization:read` only when it should see
approved MTI-wide context. Drafting and activation are separate grants.

No live database migration, credential creation, or Railway deployment is
performed automatically by this branch.
