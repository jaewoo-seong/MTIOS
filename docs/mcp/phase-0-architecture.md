# Phase 0 — External MCP Architecture and Contract Audit

## Decision

Build the external conversational gateway as a separately deployable, public MCP service. It will authenticate a dedicated external credential and call a narrow set of authenticated application API routes over Railway's private network. Those routes will call existing domain functions.

Do not import database-backed domain modules directly into both services. A private application API boundary provides one authorization and transaction boundary, avoids coupling a public transport process to the database, and keeps asynchronous Trigger.dev workflow dispatch in the application.

The existing `mcp-tools` service remains private and unchanged in purpose. Its `MCP_SERVICE_SECRET` is service-to-service authentication, not an operator credential.

## Naming and separation

- Use **internal tool bridge** for the existing private MCP service.
- Use **external conversational gateway** for the new public MCP server.
- Use `internalToolCatalog` only for internal agents.
- Use `externalMcpToolCatalog` only for external clients.
- Use separate environment variables, credentials, invocation records, rate limits, health checks, and Railway services.
- Never expose a generic internal-tool passthrough from the external gateway.

## Existing data model findings

- A project has at most one client database in practice: `client_databases.project_id` has a unique index.
- A client record may point to a canonical company and one dossier document through `company_id` and `dossier_document_id`.
- Canonical companies relate to projects through `company_project_links`; project-specific candidate data lives separately.
- Documents and reports currently each have one nullable `project_id`. Cross-project report provenance therefore needs a normalized source relationship table.
- Existing `mcp_invocations` rows describe calls from Business OS to the internal tool bridge and require an internal `server_id` and `tool_id`. External client calls have different actors and idempotency requirements and should use a separate `mcp_external_invocations` table rather than overloading this table.
- Existing session `guard` is cookie-based. External Bearer credentials require a separate guard that resolves organization, scopes, project allowlists, expiry, revocation, and credential rate limits.

## Tool-to-domain mapping

| External tool | Existing reusable surface | Gap before implementation |
| --- | --- | --- |
| `list_research_projects` | `repository.listProjects` plus research settings/campaign counts | Add organization/project-allowlist query and cursor pagination |
| `get_research_project` | `ensureResearchProject`, project strategy/settings queries | Add bounded external serializer and authorization-first lookup |
| `draft_research_project` | project creation repository operation, `ensureResearchProject`, `proposeResearchStrategy` | Add one transactional/idempotent application operation; current `ensureResearchProject` expects an existing ID |
| `activate_research_project` | `activateResearchStrategy`, normal discovery/dispatcher workflow | Add idempotent private API operation and explicit-confirmation evidence |
| `search_business_os` | `searchWorkspace`, context retrieval, research evidence tables | Current search is workspace-wide and scan-based; add DB-level organization/project filtering before retrieval |
| `get_company_research` | client records, `company_project_links`, documents, evidence | Add one bounded aggregate query and enforce the credential's project allowlist |
| `get_document` | `repository.getDocument` | Add authorization, approval metadata, provenance serializer, and truncation |
| `create_cross_project_report` | governed model route, `repository.createReport`/documents | Add normalized provenance, approved-source selection, async job, and idempotency |

## Contract source of truth

`lib/mcp/external-contracts.ts` defines the initial eight input and output schemas, tool scopes, write classification, bounds, exact approval text, and idempotency requirements. MCP registration and private application routes must import these schemas rather than restating them.

Important deliberate contract changes from the handoff:

- `create_cross_project_report` now includes explicit confirmation text because the handoff's rules required confirmation but its sample input omitted it.
- Cursors are opaque strings rather than database offsets.
- Document retrieval is capped at 50,000 characters.
- Search excerpts are capped at 2,000 characters and results at 50.
- Output contracts include stable links, pagination/truncation state, and normalized source references.

## Required migrations for Phase 1 and Phase 4

1. `mcp_external_credentials`: organization, creator, label/client, public prefix, Argon2 hash, scopes, status, expiry/use/rotation/revocation timestamps.
2. `mcp_external_credential_projects`: credential/project join table. An empty allowlist means organization-wide only when explicitly configured; project-restricted should be the creation default.
3. `mcp_external_invocations`: credential, tool name, idempotency key, request hash, redacted summary, status, timing, error code, and optional project/run/report IDs. Unique partial index on `(credential_id, tool_name, idempotency_key)` when the key is present.
4. `document_source_relationships`: report document plus source project/company/document/evidence IDs and relationship type.
5. Conversation provenance fields/table for the bounded summary, external client name, and invocation ID; keep this separate from the approved strategy.

## Security invariants

- Authenticate before MCP discovery and filter discovery by scopes.
- Recheck scopes and project access inside every application operation.
- Restrict project IDs at the SQL query boundary, before lexical or semantic retrieval.
- Store only credential hashes and show plaintext once.
- Never log Bearer tokens, full conversation summaries, document bodies, or raw tool payloads.
- Write/cost tools require an idempotency key and exact approval evidence.
- Stored content is data, not authority; prompt injection cannot broaden scopes or select unregistered tools.

## Phase 0 exit review

The design does not duplicate the research pipeline. The remaining blocking product choice has a safe default: new credentials should be project-restricted unless an administrator explicitly grants organization-wide access. Phase 1 can proceed from this decision.

## Phase 1 implementation note

Phase 1 now uses the three-table design above. Administrative APIs create, list,
rotate, and revoke credentials. The plaintext token is returned only by create or
rotate responses; every later listing omits the Argon2 hash as well as the secret.
The public MCP transport and its request guard remain Phase 2 work and must not be
enabled before the credential migration is deployed.
