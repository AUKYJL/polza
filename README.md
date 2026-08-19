# Polza

Loads the supplied company export into PostgreSQL, provides analytical SQL queries, and exposes a searchable companies table.

## Prerequisites

- Node.js and npm
- PostgreSQL installed and running locally
- `psql` available in the terminal

## Setup and import

Install dependencies:

```bash
npm install
```

Copy `.env.example` to an ignored local file, then replace the placeholder credentials with the connection URL for a dedicated local database (for example, `polza_task1`):

```bash
cp .env.example .env.local
```

Set `DATABASE_URL` in `.env.local` to the connection URL for that database, without `?schema=public`. The npm database commands load this file automatically. Start or configure your local PostgreSQL service using your platform's normal tooling; Docker is not required.

The importer discovers all files named `page_*.json` in repository-root `data/`, outside `src/`. Keep the supplied source files there.

Apply the schema and load the export:

```bash
npm run db:schema
npm run load:companies
```

The supplied export contains 1,000 raw rows. It should produce 994 unique company rows: six repeated source IDs are exact duplicates. Re-running the importer is safe: it upserts by `source_id` and keeps the final row count stable.

Run the analytical queries:

```bash
set -a
. ./.env.local
set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/queries.sql
```

The direct `psql` command requires `DATABASE_URL` in its environment. Keep the
URL compatible with `psql`; in particular, do not add a `?schema=...` query
parameter.

## Deduplication and import trade-off

Rows with the same source ID and identical fields are retained once and reported as exact duplicates. Conflicting versions of a source ID are excluded rather than arbitrarily choosing one; the importer reports every conflicting source location.

The importer intentionally uses an in-memory `Map` for the supplied small export. For materially larger imports, a staging-table and `COPY`-based approach should be reconsidered.

## Companies page

After importing the database, start the application and open [http://localhost:3000/companies](http://localhost:3000/companies):

```bash
npm run dev
```

The page fetches data through `GET /api/companies`. `search` performs a case-insensitive partial company-name search; `city` filters by an exact, database-derived city. Empty filters return all companies, unknown cities return an empty result, and repeated query parameters return `400`. The browser accesses company data only through this Route Handler; PostgreSQL credentials remain server-side.

The API returns up to 100 companies per request, ordered by name and source ID. The table intentionally has no pagination or sorting controls; if the dataset grows materially, reassess server-side pagination and search indexing before adding them.

## Evidence

The following screenshots were captured during the Task 2 manual verification:

- `reports/task2/companies-default.png` — default `/companies` table state.
- `reports/task2/companies-search.png` — partial `аврора` name-search results.
- `reports/task2/companies-search-city.png` — combined `аврора` and `Москва` filters.
- `reports/task2/companies-no-results.png` — no-results state.

### How I tested it

With the local Next.js application and PostgreSQL database running, I opened `/companies` and confirmed that the default request rendered 100 rows and 20 database-derived city options. I searched for `аврора`, filtered by `Москва`, and confirmed that the combined URL preserved both filters and returned seven matching rows. I also verified the no-results state, reset behavior, a 375 px-wide viewport with horizontal table scrolling, and a quote-containing search string treated as ordinary text. No genuine UI or API defects were found during this manual verification stage.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```
