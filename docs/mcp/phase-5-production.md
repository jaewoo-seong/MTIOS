# Phase 5: production hardening and client setup

Phase 5 is implemented in code. Production deployment and real-account client
verification remain release gates because they require the public HTTPS domain,
a migrated production database, and operator-created credentials.

## Account and credential model

Create one Business OS MCP credential for each external client/account boundary:
`person + client + environment`. For example, one operator using Codex and Claude
gets two credentials. A staging client never shares a production credential.

The external account does not become a Business OS user. Its credential maps it
to one MTI organization, an allowlist of projects (or explicit organization-wide
access), and scopes. This makes revocation, attribution, client metrics, and
least-privilege changes independent between accounts. Never share one token
between people or clients.

Recommended defaults:

- selected-project access;
- `projects:read`, `companies:read`, and `documents:read` only;
- 30–90 day expiration;
- separate credentials for draft, execution, and report writes;
- immediate rotation after suspected disclosure.

## Current client configuration

These examples follow the currently published vendor formats. Recheck the
linked primary documentation during each release because client configuration
formats can change.

### Codex

Codex uses Streamable HTTP MCP servers from `~/.codex/config.toml` and supports
reading the bearer token from an environment variable. Use
[`client-configs/codex.config.toml.example`](./client-configs/codex.config.toml.example),
set `MTI_MCP_TOKEN`, and restart/reload the client. The same configuration is
shared by Codex CLI and the Codex IDE extension. See the official
[Codex MCP documentation](https://developers.openai.com/codex/mcp).

### Claude Code

Use the project or user-scoped
[`client-configs/claude.mcp.json.example`](./client-configs/claude.mcp.json.example).
Its URL and authorization header expand environment variables, keeping the
token out of the repository. The equivalent CLI setup supports HTTP transport
and custom headers, but a literal header passed on a command line may enter shell
history. See the official
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Gemini CLI

Use the `httpUrl` and `headers` structure in
[`client-configs/gemini.settings.json.example`](./client-configs/gemini.settings.json.example)
or `gemini mcp add --transport http --header ...`. Keep `trust` false so tool
calls remain subject to client confirmation. The official page documents
environment expansion for server `env`, but does not currently guarantee the
same for arbitrary HTTP headers, so inject the bearer value into the user-local
settings file with a secret manager and never commit it. See the official
[Gemini CLI MCP server documentation](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## Release procedure

1. Apply database migrations through `0033_clammy_boomerang.sql` before the new
   app and gateway versions receive traffic.
2. Configure the same distinct 32+ character `EXTERNAL_MCP_GATEWAY_SECRET` on
   the app and public gateway. It must not equal `MCP_SERVICE_SECRET`.
3. Set the gateway's `BUSINESS_OS_INTERNAL_URL` to the app's private Railway
   address, allowed public host, optional browser origins, and internal timeout.
4. Deploy the app, then the external gateway. `/health` must return 200 and
   version `0.3.0`; a missing private URL or weak secret returns 503.
5. In the admin Access settings, create a short-lived read-only credential for
   one selected project. Copy the token from its one-time reveal.
6. Run the protocol smoke test:

   ```bash
   MTI_MCP_ENDPOINT=https://<domain>/mcp \
   MTI_MCP_TOKEN='<one-time-token>' \
   MTI_MCP_EXPECTED_TOOLS=list_research_projects,get_project_briefing \
   npm run test:mcp:external
   ```

7. Connect Codex and one second client (Claude or Gemini). Verify instructions,
   tool discovery, assistant-role resource, brainstorming prompt, one bounded
   read, and denial of a tool outside the credential's scopes.
8. Rotate the credential and verify the old token fails on its next request.
   Revoke the replacement and verify the same. Record the validation date and
   client versions in the release record.
9. Review the 30-day admin metrics for calls, failures, p95 latency, truncated
   results, and synchronous MCP-attributed model cost.

Do not use a write-capable production credential for connectivity testing.
Draft, activation, and report tools require separate validation with a disposable
project, exact confirmation, idempotency keys, and budget limits.

## Revocation and incident response

For a lost token, suspicious IP/activity, or departed operator:

1. Revoke the credential in Access settings; do not wait for an investigation.
2. Confirm the next authenticated request receives an opaque 401.
3. Review recent failures, client/tool call counts, and invocation audits by
   credential ID. Invocation records contain summaries and error codes, not
   bearer tokens or full request payloads.
4. If the gateway secret may be exposed, rotate it on both services together,
   deploy both, and confirm `/health`. External client tokens do not need to be
   replaced when only the private gateway secret changes.
5. If an external bearer token may be exposed, create a new credential with the
   minimum scopes and update only that client/account.

## Security review

| Threat | Control | Verification |
| --- | --- | --- |
| Token theft | Argon2 hash at rest, one-time display, expiry, rotation, revocation, HTTPS-only runbook | credential and gateway tests |
| Cross-project access | organization binding plus selected-project allowlist on every domain query | authorization/integration tests |
| Internal-tool breakout | explicit external catalog; no arbitrary tool, URL, SQL, shell, provider key, or admin tools | contract and discovery tests |
| Cost escalation | separate execute/report scopes, exact approval, idempotency, project budgets, rate limits | scope and workflow tests |
| Prompt injection | stored content is data; cannot change scopes or discover hidden tools | fixed server catalog and authorization before retrieval |
| Denial of service | 1 MB request cap, bounded outputs, 25–60000 ms private timeout, Redis-backed client-IP/credential limits | malformed, load, timeout, and rate-limit tests |
| Information leakage | opaque errors, no framework header, no-store responses, redacted audit records | gateway tests |
| Browser cross-origin misuse | explicit optional origin allowlist; native clients need no Origin | origin tests |

Residual operational risks:

- Rate limiting fails open when Redis is unavailable; production health/alerts
  must treat Redis loss as an incident and the gateway can be disabled at the
  edge until it recovers.
- Model-cost attribution covers model calls completed synchronously inside an
  MCP invocation. Asynchronous research continues to be accounted to its normal
  project/run budget rather than the initiating HTTP call.
- The metrics query caps its detailed 90-day window at 10,000 invocations and
  reports `capped: true`; use database/observability aggregation at higher scale.

## Rollback

Disable the public gateway or remove its public domain first. Existing Business
OS and internal MCP behavior is independent. Revoke external credentials if the
outage is security-related. Application rollback is safe after exposure stops;
the additive invocation metrics columns may remain in the database.

## Local conformance evidence

Automated tests cover the official SDK transport and an independent raw
JSON-RPC Streamable HTTP client, 25 concurrent discovery requests, timeout,
revocation, origin rejection, oversized/malformed payloads, scope filtering,
and opaque errors. The production smoke runner performs discovery and a bounded
read against the deployed endpoint without printing its bearer token.
