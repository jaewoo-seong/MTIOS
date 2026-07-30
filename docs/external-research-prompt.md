# Prompt for an external research agent

Give this to whatever agent does the research. Its output drops straight into
`scripts/import-research.mjs` with no reshaping.

## Two ways to import

**In the app** — Client & Data, pick the database, **Import research**. Select
the CSV and every `.md` together, choose a project, import. Selection is
validated in the browser before anything uploads.

**From a terminal**, for large sets or scripting:

```bash
npx tsx scripts/import-research.mjs ./research-output --database <uuid> --project <uuid> --dry-run
```

Drop `--dry-run` and prefix with `railway run --service app` to run it for
real. Both paths share `lib/research-import.ts`, so they accept and reject
exactly the same things.

---

## The prompt

> You are producing a research deliverable that will be imported into a
> business system. The format is strict: a downstream importer parses it
> mechanically, so deviations cause a rejected import, not a best-effort read.
>
> **Research task:** `<describe what to find — e.g. "Kickstarter hardware
> companies, currently fundraising, that manufacture physical consumer
> electronics">`
>
> **How many:** `<e.g. 100>`
>
> ### Deliver exactly two things
>
> **1. One CSV file** — one row per entity.
>
> - First row is the header. Column names become database fields, so name them
>   for a reader: `companyName`, not `col_1`.
> - Include a `reportFile` column. Every value is the filename of that
>   entity's Markdown report, including the `.md` extension.
> - Do **not** include a column called `Dossier Document`. The importer adds
>   it.
> - Quote any value containing a comma, quote, or newline; escape an internal
>   quote by doubling it (`""`). Standard RFC 4180.
> - **Never leave a cell empty-but-unquoted.** Use `""` for unknown, or the
>   literal `unknown`. Never `null`, `N/A`, or `-`.
> - Write numbers as plain strings: `50000`, not `$50,000` or `50k`. Keep
>   units in the column name (`fundingGoalUsd`).
> - Use ISO dates: `2026-03-14`.
> - Always include `contactName` and `contactEmail`. A qualifying entity
>   nobody can be reached at is not actionable. Where either is genuinely
>   unpublished, write `unknown` — do not guess an address from a pattern like
>   `firstname@company.com`, which reads as verified and bounces.
> - Keep columns under about twelve. A field only some entities have belongs
>   in the report, not the table.
>
> **2. One Markdown file per entity**, named exactly as its `reportFile` says.
>
> - Filenames: lowercase, hyphens, no spaces or punctuation —
>   `acme-robotics.md`. They must be unique.
> - Every row needs a file, and every file needs a row. No extras either way.
> - Start with a single `#` heading naming the entity, then use `##` for
>   sections. Keep the same section structure across all reports so they read
>   as one set.
> - Plain Markdown only: headings, paragraphs, lists, tables, links. No HTML,
>   no images, no front-matter, no code fences around the whole document.
>
> ### Suggested report structure
>
> ```markdown
> # Acme Robotics
>
> ## Summary
> Two or three sentences: what they do and why they qualify.
>
> ## Profile
> Founded, location, size, stage — whatever the criteria call for.
>
> ## Findings
> - Specific, sourced claims.
> - One claim per bullet.
>
> ## Fit
> Why this entity matches the brief, concretely.
>
> ## Sources
> - [Title](https://example.com/page) — retrieved 2026-07-30
> ```
>
> ### Rules about accuracy
>
> - **Never invent a value to fill a field.** Omit it, or write `unknown`. An
>   absent fact is usable; a fabricated one is not, and it will be approved
>   into a database as if it were verified.
> - Cite a source for every non-obvious claim. Link the specific page, not the
>   homepage.
> - Where sources disagree, say so in the report rather than silently choosing.
> - Distinguish what you confirmed from what you inferred.
> - If you cannot find the requested number of qualifying entities, deliver
>   fewer and say why. Padding with weak matches is worse than a short list.
>
> ### Output
>
> One flat folder:
>
> ```
> research-output/
>   companies.csv
>   acme-robotics.md
>   bolt-devices.md
>   ...
> ```
>
> Exactly one `.csv`. Everything else `.md`. No other file types, no
> subfolders.

---

## Worked example

`companies.csv`

```csv
companyName,country,fundingGoalUsd,stage,contactName,contactEmail,launchDate,reportFile
Acme Robotics,USA,50000,live,Dana Whitfield,hello@acme.example,2026-03-14,acme-robotics.md
Bolt Devices,Korea,12000,pre-launch,unknown,unknown,2026-05-02,bolt-devices.md
Cinder Optics,Japan,unknown,live,Rei Nakamura,sales@cinder.example,2026-01-20,cinder-optics.md
```

Note: `Cinder Optics` has an unknown funding goal written as `unknown`, not
left blank. `fundingGoalUsd` carries its unit in the name, so values stay
plain numbers.

## What happens on import

1. Each `.md` is uploaded as a document. Because it is already text, it skips
   the conversion service entirely — no OCR, no per-file conversion cost.
2. A single change set is staged with one `insert` per row, each carrying a
   `Dossier Document` field holding its uploaded report's id.
3. It is submitted for review and stops there. **Nothing enters client data
   until you approve it** — direct record writes are disabled by design.
4. After approval, each row shows a **View report** action that opens its
   report.

`reportFile` is routing information and is dropped before staging; it does not
become a column.
