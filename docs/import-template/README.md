# Import template

A working example. Copy this folder, replace the contents, import.

```
companies.csv        one row per entity
acme-robotics.md     one report per entity
bolt-devices.md
cinder-optics.md
```

Validate a folder any time — it uploads nothing:

```bash
npx tsx scripts/import-research.mjs docs/import-template --database <uuid> --project <uuid> --dry-run
```

## The database template

`companies.csv` uses ten columns. Only `reportFile` is required by the
importer; everything else is yours to choose, and each column becomes a field
in the client database exactly as named.

| Column | Why it looks like this |
| --- | --- |
| `companyName` | Named for a reader. Column names are what people see in the table. |
| `country` | Short, consistent values — easier to filter than free text. |
| `industry` | |
| `stage` | A small fixed vocabulary (`live`, `pre-launch`, `funded`) beats prose. |
| `fundingGoalUsd` | Unit lives in the **name**, so values stay plain numbers. |
| `website` | |
| `contactName` | Who to write to. An address with no name is far less likely to get a reply, and it is the field most often missing from scraped research. |
| `contactEmail` | `unknown` where absent — never blank, never `N/A`. |
| `launchDate` | ISO `YYYY-MM-DD`, so dates sort correctly as text. |
| `reportFile` | **The join key.** The filename of this row's report. |

Rules the importer enforces:

- Every value is text. Write `50000`, not `$50,000` or `50k`.
- Unknown means `unknown` or `""` — never `null`, `N/A`, or a bare blank.
- Quote any value containing a comma or quote; double an internal quote
  (`"Quoted ""best in class"" by press"`).
- No column named `Dossier Document` — the importer adds it.
- Column names must be unique and non-blank.
- Up to 1000 rows per import.

Keep it to roughly a dozen columns. A field only a few entities have belongs
in the report, not the table.

## How each .md connects to its row

The link is made in two steps, because a document has no id until it exists.

**1. Before import — matched by filename.**

`reportFile` in the CSV holds the exact filename of that row's Markdown file:

```csv
companyName,reportFile
Acme Robotics,acme-robotics.md
```

Matching is exact: `acme-robotics.md` and `Acme-Robotics.md` are different
files. The importer checks every referenced file exists **before uploading
anything**, so a typo fails the whole import rather than leaving orphaned
documents behind. Two rows may not point at the same file — each entity needs
its own report.

**2. At import — replaced by a document id.**

Each `.md` is uploaded and comes back with a UUID. The importer then writes
that UUID into a field called **`Dossier Document`** on the matching row, and
**drops `reportFile`** — routing information, not something anyone wants as a
column.

So a row that started as:

```
companyName = "Acme Robotics"
reportFile  = "acme-robotics.md"
```

is staged as:

```
companyName      = "Acme Robotics"
Dossier Document = "9f3c…-a41b"
```

**3. In the app — the column name is the contract.**

`components/client-data-view.tsx` looks for the literal column
`Dossier Document`. When a row has one, that cell renders as a **View report**
action opening the linked document instead of showing a raw UUID. Any other
column name renders as plain text — which is why the name is fixed and why the
importer refuses a CSV that already contains it.

Rows are staged as a proposal and enter the database only after you approve
the change set. Direct record writes are disabled by design, so nothing here
bypasses review.

## Linking reports to rows that already exist

This template covers importing rows and reports together. To attach a report
to a row already in the database, the same contract applies — the row needs a
`Dossier Document` field holding the document's id — but it has to go through
an `update` item in a change set rather than this importer, which only creates
new rows.
