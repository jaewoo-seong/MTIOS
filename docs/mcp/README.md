# MTI Business OS MCP

This folder is the design and implementation index for Model Context Protocol support.

## Two MCP boundaries

| Boundary | Business OS role | Network exposure | Purpose | Code |
| --- | --- | --- | --- | --- |
| Internal tool bridge | MCP host/client | Private only | Lets Business OS agents call governed adapters such as research, storage, and Gmail | `services/mcp-tools/server.ts`, `lib/mcp/catalog.ts`, `lib/mcp/platform.ts` |
| External conversational gateway | MCP server | Public authenticated HTTPS | Lets Codex, Claude, Gemini, and other MCP clients retrieve or initiate Business OS work | `services/mcp-external/server.ts`, `lib/mcp/external-contracts.ts` |

They should remain distinct at the transport, credential, catalog, and deployment layers. They should share domain functions, authorization primitives, audit conventions, budgets, and entity IDs. The external gateway must not proxy arbitrary internal tools.

## Documents

- [Original implementation handoff](../mcp-conversational-access-implementation-plan.md)
- [Phase 0 architecture and contract audit](./phase-0-architecture.md)
- [Phase 2 read-only gateway](./phase-2-read-only-gateway.md)
- [Phase 3 conversational projects and brainstorming](./phase-3-projects-and-brainstorming.md)
- [Phase 4 cross-project reports and organization profile](./phase-4-cross-project-reports.md)
- [Phase 5 production hardening and client setup](./phase-5-production.md)

## Implementation status

- Phase 0: contracts and architecture decision completed on `codex/mcp-conversational-access`.
- Phase 1: in progress. Credential schema, one-time token creation, Argon2 verification,
  project allowlists, expiration, rotation, revocation, and admin APIs are implemented.
- Phase 2: implemented in code. The external gateway exposes five scoped,
  read-only tools over authenticated Streamable HTTP and calls the application
  through a private service boundary. Deployment and live client validation
  require production secrets, a migrated database, and a Railway service.
- Phase 3: implemented in code. External assistants receive MTI/project role
  context, can brainstorm without writing state, can create an idempotent draft
  and proposed strategy, and can activate it only through a separate confirmed
  operation.
- Phase 4: implemented in code. Admins can version and approve the official MTI
  Company Profile, and authorized MCP clients can create idempotent reports from
  exact approved revisions across several projects with durable provenance,
  bounded context, source coverage, and authenticated deep links.
- Phase 5: implemented in code. It includes admin credential operations and
  metrics, two protocol-client conformance paths, load/failure/security tests,
  current Codex/Claude/Gemini examples, a production smoke runner, security
  review, revocation procedure, release checklist, and rollback. Deployment and
  live account verification remain release gates.
