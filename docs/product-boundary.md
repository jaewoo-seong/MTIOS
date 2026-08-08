# Research workspace product boundary

## Active product

MTI OS is a continuous client-research workspace. A project owns its strategy, discovery queue, bounded dossier workers, client database, documents, and immutable document versions.

The supported primary navigation is:

1. **Projects** — converse with the premium strategist, review the active strategy, prioritize the company queue, set the dossier-worker limit, and review dossiers.
2. **Documents** — import text, Markdown, or simple Word files; read and edit master dossiers; create manual versions; and send AI-created documents through the separate rework queue.
3. **Client Databases** — one database per project, with one company per row and a link to its dossier document.
4. **Settings** — service status, task-aware model policies, observed usage/quota analytics, access governance, and workspace preferences.

Executive Command is intentionally available only on Projects. It is not part of Documents, Client Databases, or Settings.

## Model boundary

- Premium routes own strategy and final review.
- Worker routes default to free OpenRouter candidates.
- Lightweight cleanup, classification, extraction, formatting, translation, and project-brief organization always use the free worker pool. They must not call the premium strategist merely because they appear inside a premium-led workflow.
- Auto mode ranks eligible candidates for each individual request using its task type, language, context length, tool/structured-output needs, availability, and quota—not a single provider-wide auto model.
- A policy change is activated only after every route has at least one tested eligible candidate.

## Import boundary

Only `.txt`, `.md`, `.markdown`, and structurally simple `.docx` imports are supported. PDF, legacy Word, macro-enabled Word, embedded-object, tracked-change, media-heavy, and unsafe or unusually complex archives are rejected before a document record is created. See [document-importing.md](./document-importing.md).

## Development audit mode

Set both variables only in local development:

```bash
UI_AUDIT_MODE=true
NEXT_PUBLIC_UI_AUDIT_MODE=true
```

This provides deterministic projects, queue states, dossiers, client records, model usage, and quota data. Authentication is bypassed locally, provider calls are disabled, and the app displays a persistent warning banner. Startup fails if server-side audit mode is enabled in production.

## Archived and deferred

The old campaign, knowledge, activity, and client-change dashboard components live in `archive/legacy/components` and are excluded from TypeScript and Docker build contexts. Legacy API and database contracts remain temporarily because removing them safely requires a production-data migration and ownership check. They are not part of the active user experience.

Deferred work includes PDF importing/OCR and removal of legacy database/API contracts after migration verification.
