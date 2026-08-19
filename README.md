# Polza Task 1

Loads the supplied company export into a local PostgreSQL database and provides three analytical SQL queries.

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

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```
