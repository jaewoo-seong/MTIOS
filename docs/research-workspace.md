# Continuous research workspace

Each project is an isolated research program with one active strategy, one continuous company campaign, one queue, one linked client database, and versioned dossier documents.

## Durable context

- `project_strategy_versions` stores immutable proposed/active/superseded strategy snapshots.
- `project_strategy_messages` stores the operator/strategist conversation.
- `project_research_settings` stores worker limits, queue target, pause state, and discovery cursor.
- `canonical_companies` plus `company_project_links` prevents rediscovering the same company inside a project; name/domain identity can be reused across projects.
- `collection_candidates` is the durable queue. Priority, hold state, qualification score, dossier status, strategy version, and operator disposition are never kept only in an agent prompt.
- `documents` and `document_revisions` hold the dossier master file and immutable versions.
- `dossier_revision_requests` is a separate rework queue, so feedback jobs do not consume the primary dossier-worker limit.

## Runtime flow

1. The premium strategist proposes a complete strategy version from project context and conversation history.
2. Operator approval atomically activates one strategy and starts or updates the project's continuous campaign.
3. Discovery rotates through strategy query families, verifies candidates against web evidence, registers canonical identity, and fills only the configured queue buffer.
4. The dispatcher claims the highest-priority queued companies up to the project's live dossier-worker limit.
5. Each dossier worker runs a bounded, section-oriented research pass, qualifies the company, and writes a cited master dossier.
6. Publication creates the dossier document and proposes its linked row for the project's client database.
7. Operator dispositions place dossiers into review, approved, declined, or needs-revision bins.
8. Feedback creates a separate revision request. Its worker researches the requested gaps and returns an unapproved document version; accepting it is conflict-safe against newer manual edits.
9. A production heartbeat restarts eligible project loops every 15 minutes after empty passes, outages, or deployments.

## Release order

1. Configure `WORKER_MODEL` on both the app and LiteLLM Railway services. The model must support structured JSON output.
2. Apply Drizzle migrations `0022` and `0023` to production PostgreSQL.
3. Deploy Trigger.dev tasks with the SDK-matched CLI version.
4. Deploy LiteLLM, then the app.
5. Verify health, create a project, approve a strategy, and confirm discovery, dossier publication, linked client row, manual editing, and a proposed revision version.

Do not deploy the app before the database migration or the Trigger.dev task deployment; the UI would expose controls whose durable tables or background workers do not yet exist.
