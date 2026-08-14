# Phase 2 — Read-only conversational MCP

## Delivered architecture

The `mcp-external` service is the public Streamable HTTP transport. It does not
connect to PostgreSQL or import application domain operations. For every MCP
request it forwards the external Bearer credential to a private Business OS API
and authenticates itself with `EXTERNAL_MCP_GATEWAY_SECRET`.

The application resolves the credential, organization, scopes, expiration,
revocation state, creator status, access mode, and selected projects. Tool
discovery is filtered before the MCP server registers tools. Every invocation
rechecks scopes and project access at the database query boundary.

## Read-only tools

| Tool | Required scope | Boundaries |
| --- | --- | --- |
| `list_research_projects` | `projects:read` | Maximum 100, opaque cursor, selected-project filtering |
| `get_research_project` | `projects:read` | One authorized project; optional strategy and counts |
| `search_business_os` | all four read scopes | Maximum 50 results across explicitly authorized projects |
| `get_company_research` | `companies:read` | Company must link to an authorized project; dossier/evidence fields require their own scopes |
| `get_document` | `documents:read` | Authorized project document only; 50,000-character maximum |

Search applies organization and project predicates before matching companies,
documents, dossiers, or research evidence. Results contain stable IDs, bounded
excerpts, dates, confidence where available, and Business OS links.

## Private application endpoints

- `GET /api/internal/external-mcp/principal` authenticates the credential and
  returns its discoverable read tool names.
- `POST /api/internal/external-mcp/invoke` validates the shared Zod contract,
  executes one registered read tool, validates its output, and writes a redacted
  invocation audit record.

Both endpoints require the gateway service secret and the external Bearer token.
Browser session cookies do not authorize them.

## Operational controls

- One-megabyte request size limit at the public gateway.
- Fifteen-second private application timeout.
- Per-origin and per-credential shared rate limits.
- Optional exact browser-origin allowlist.
- Host allowlist for DNS-rebinding protection.
- Stateless MCP transport; no server session is retained.
- No secrets, document bodies, full arguments, or full results in invocation logs.
- Opaque public errors; detailed unexpected failures remain in application logs.

## Deployment checklist

1. Apply migration `0029_conscious_senator_kelly.sql` to staging.
2. Deploy the application with `EXTERNAL_MCP_GATEWAY_SECRET`.
3. Deploy `railway/mcp-external/Dockerfile` with the same secret, the private
   application URL, and its allowed public hostname.
4. Create a short-lived, selected-project, read-only credential through the
   admin API. Copy the token once.
5. Connect an MCP client to `https://<domain>/mcp` with the token as Bearer auth.
6. Confirm discovery omits every write tool.
7. Retrieve an allowed project and reject an unlisted project.
8. Revoke the credential and confirm the next MCP request returns 401.

No live deployment or database migration is performed by this branch alone.
