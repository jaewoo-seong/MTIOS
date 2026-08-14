# Phase 4: cross-project reports

Phase 4 adds the external `create_cross_project_report` write tool. It creates a
reviewable Business OS report from several authorized projects while preserving
the exact document revisions used as sources.

## Safety and authorization

- The credential requires `reports:create`.
- Every requested project is checked against the credential's organization or
  selected-project allowlist before source discovery.
- The default `approved_dossiers_only` policy includes only AI-generated
  documents with an explicitly approved document revision.
- `approved_sources` broadens document type, but still requires an approved
  revision. Draft/current markdown is never substituted for an approval.
- Optional `sourceDocumentIds` are fail-closed: an unavailable, unauthorized,
  non-policy-matching, or unapproved selection rejects the request.
- `maxSources` and `maxSourceCharacters` bound the assembled context.
- Exact confirmation text and the existing credential-scoped idempotency key
  are required.

## Provenance

`report_projects` records every requested project. `report_sources` records the
exact document and approved revision, its adjacent citation key, source link,
and included character count. Foreign keys use `restrict` for source entities,
so a report cannot silently lose its provenance.

The saved report content is an evidence packet. Each included excerpt has an
adjacent source link, and the report explicitly states that stored claims are
not independently verified conclusions. Reports enter `review` state and have
an authenticated deep link at `/reports/:reportId`.

## Organization context

Settings → Tools & access now includes an admin-only MTI Company Profile.
Admins edit a draft version and explicitly approve it. Approval supersedes the
previous live version; approved versions are immutable. External MCP clients
receive only the active approved version and only when their credential has
`organization:read`.

General `knowledge_entries` remain useful working memory, but they are no
longer treated as the official company identity in `get_project_briefing`.
