# Continuous research workspace

Each project is an isolated research program with one active strategy, one continuous company campaign, one queue, one linked client database, and versioned dossier documents.

## Durable context

- `project_strategy_versions` stores immutable proposed/active/superseded strategy snapshots.
- `project_strategy_messages` stores the operator/strategist conversation.
- `project_research_settings` stores worker limits, the automatic/manual queue cap, pause state, and discovery cursor.
- `canonical_companies` plus `company_project_links` prevents rediscovering the same company inside a project; name/domain identity can be reused across projects.
- `collection_candidates` is the durable queue. Priority, hold state, qualification score, dossier status, strategy version, and operator disposition are never kept only in an agent prompt.
- `documents` and `document_revisions` hold the dossier master file and immutable versions.
- `dossier_revision_requests` is a separate rework queue, so feedback jobs do not consume the primary dossier-worker limit.

## Runtime flow

1. The premium strategist proposes a complete strategy version from project context and conversation history. It includes a scope-aware company target, a focused dossier research blueprint, required evidence for each section, and information workers should deliberately skip.
2. Operator approval atomically activates one strategy and starts or updates the project's continuous campaign.
3. Discovery rotates through strategy query families, verifies candidates against web evidence, registers canonical identity, and fills only the configured queue buffer. It stops adding companies when the active campaign reaches the approved company target.
4. The dispatcher claims the highest-priority queued companies up to the project's live dossier-worker limit.
5. Each dossier worker receives the frozen strategy version and its synchronized blueprint, runs a bounded section-oriented research pass, and writes a cited master dossier. Every blueprint must prioritize verified public buyer/contact paths, explain why the company may need specific MTI services, and describe the practical path for turning it into a client. Every material claim uses an adjacent descriptive Markdown hyperlink; bare URLs are not dossier output.
6. Publication creates the dossier document and proposes its linked row for the project's client database.
7. The project knowledge view presents dossiers as a compact list or paper-card carousel. Either view can approve, deny, return, or open the full editable document.
8. Feedback creates a separate revision request. Its worker researches the requested gaps and returns an unapproved document version; accepting it is conflict-safe against newer manual edits.
9. A production heartbeat restarts eligible project loops every 15 minutes after empty passes, outages, or deployments.

## Queue capacity

- Automatic mode is the default: `queue maximum = dossier worker limit × 3`.
- Changing the dossier worker limit immediately recalculates the queue maximum while automatic mode is active (for example, 3 workers = 9 queued companies and 5 workers = 15).
- Using the queue maximum minus/plus controls switches that project to a manual override. Later worker-limit changes preserve the manual value.
- **Auto 3×** removes the override and recalculates from the current dossier worker limit.
- The queue maximum is a backpressure cap, not the total project goal. The strategist's company target is the total number of unique qualified companies the campaign should collect.

## Release order

1. Configure `WORKER_MODEL` on both the app and LiteLLM Railway services. The model must support structured JSON output.
2. Apply all pending Drizzle migrations through `0027_automatic_queue_target.sql` to production PostgreSQL.
3. Deploy Trigger.dev tasks with the SDK-matched CLI version.
4. Deploy LiteLLM, then the app.
5. Verify health, create a project, approve a strategy, and confirm discovery, dossier publication, linked client row, manual editing, and a proposed revision version.

Do not deploy the app before the database migration or the Trigger.dev task deployment; the UI would expose controls whose durable tables or background workers do not yet exist.
