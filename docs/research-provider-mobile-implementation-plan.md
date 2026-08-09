# Research provider and mobile rollout plan

## Current implementation status

- Phase 1 is implemented: essential provider accounts and bounded Korea/U.S./global dossier enrichment.
- Phase 2 strategy capability selection and per-dossier routing are implemented. Project-level market-context snapshots remain to be added.
- Phase 3 usage/health tracking exists; provider-specific connection tests and specialized KIPRIS/Work24 adapters remain.
- Phase 4 has started: the project queue now has a mobile card workflow and the dossier review/rework layout has mobile-specific controls. Broader device, accessibility, and slow-network coverage remains.

## Phase 1 — Essential provider foundation

- Use the existing provider-account, quota, cooldown, health, and usage tables.
- Support Tavily, Firecrawl, OpenDART, Korean Public Data, SAM.gov, Census, FRED, and KOSIS in the provider-account UI.
- Keep secrets in deployment environment storage; database rows contain only the environment-variable reference and account metadata.
- Automatically attach bounded official enrichment to dossier evidence: GLEIF globally; OpenDART and business-status verification for Korea; SEC and optional SAM.gov for the United States.
- Cache enrichment in the campaign evidence pool so another worker or revision does not pay for the same lookup again.

## Phase 2 — Strategy-aware evidence routing

- Extend strategy output with evidence capabilities, not provider names: filings, business status, government supplier, patents, hiring, and market context.
- Add a deterministic provider planner that maps capabilities, country, identifiers, configured keys, quota, and project cost policy to calls.
- Use market APIs such as Census, KOSIS, FRED, and World Bank once per project/strategy rather than once per company.
- Add NTS/KONEPS identity fields to canonical companies and use them before queue admission where available.

## Phase 3 — Coverage and operations

- Show provider calls, cache reuse, remaining quota, errors, freshness, and dossier-section coverage in AI Analytics.
- Add connection tests and provider-specific quota presets in Settings.
- Add KIPRIS and Work24 only for projects that require IP or hiring evidence.
- Add paid corporate sources only behind explicit project approval and a cost cap.

## Phase 4 — Mobile product and capacity testing

- Define mobile jobs separately: check research status, reprioritize/hold a company, approve or decline a dossier, comment, request a revision, and read a dossier comfortably.
- Replace desktop tables with mobile cards and progressive disclosure; keep primary actions reachable with one hand and make controls at least 44px.
- Use a dedicated dossier reading/editing mode with a sticky review toolbar, section navigation, autosave state, and conflict recovery.
- Test responsive layouts at 320, 375, 390, 430, 768, and desktop widths, including long Korean/English names and onscreen keyboards.
- Test actual mobile behavior: touch targets, focus order, screen readers, rotation, slow networks, interrupted requests, background/resume, large documents, and three simultaneous live dossier updates.
- Treat full document editing as a focused mobile workflow, not a compressed desktop editor. Preserve versioning, revision feedback, and offline draft recovery.
