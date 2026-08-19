import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { getDbPool } from "../src/shared/lib/db-pool";
import { companySchema, type Company } from "./company-import-schema";

const BATCH_SIZE = 500;
const CSV_HEADERS = [
  "id",
  "name",
  "category",
  "city",
  "address",
  "rating",
  "reviews_count",
  "site",
  "phone",
] as const;
const COMPANY_COLUMNS = [
  "source_id",
  "name",
  "category",
  "city",
  "address",
  "rating",
  "reviews_count",
  "site",
  "phone",
] as const;
const PAGE_FILE_PATTERN = /^page_\d+\.json$/;
const SOURCE_ID_PATTERN = /^c_\d{6}$/;
const PHONE_PATTERN = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/;
const WINDOWS_1251_DECODER = new TextDecoder("windows-1251");
const WINDOWS_1251_BYTES = new Map(
  Array.from({ length: 256 }, (_, byte) => [WINDOWS_1251_DECODER.decode(Uint8Array.of(byte)), byte]),
);

type RawCsvRow = {
  line: number;
  values: string[];
};

type RawReviewRow = Record<(typeof CSV_HEADERS)[number], string> & { line: number };

type ImportStats = {
  rawRows: number;
  blankRows: number;
  malformedRows: number;
  exactDuplicates: number;
  conflictingIds: number;
  validationSkips: number;
  candidates: number;
  inserted: number;
  updated: number;
  idRangeWarnings: number;
  normalizations: Map<string, number>;
};

type BaselineDomains = {
  cities: Set<string>;
  categories: Set<string>;
  maxSourceId: number;
};

function parseCsv(input: string): RawCsvRow[] {
  const rows: RawCsvRow[] = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (quoted) {
      if (character === '"' && nextCharacter === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value) {
        throw new Error(`Unexpected quote at line ${line}`);
      }
      quoted = true;
    } else if (character === ",") {
      values.push(value);
      value = "";
    } else if (character === "\r" && nextCharacter === "\n") {
      values.push(value);
      rows.push({ line: rowLine, values });
      values = [];
      value = "";
      index += 1;
      line += 1;
      rowLine = line;
    } else if (character === "\n" || character === "\r") {
      values.push(value);
      rows.push({ line: rowLine, values });
      values = [];
      value = "";
      line += 1;
      rowLine = line;
    } else {
      value += character;
    }
  }

  if (quoted) {
    throw new Error(`Unclosed quoted field at line ${rowLine}`);
  }
  if (values.length > 0 || value) {
    values.push(value);
    rows.push({ line: rowLine, values });
  }

  return rows;
}

function recordNormalization(stats: ImportStats, rule: string): void {
  stats.normalizations.set(rule, (stats.normalizations.get(rule) ?? 0) + 1);
}

function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.map(String).join(".") || "record"}: ${issue.message}`)
    .join("; ");
}

function normalizeMojibake(value: string, stats: ImportStats): string {
  const suspiciousCharacters = [...value].filter((character) => /[\u0400-\u040f\u0452-\u045f]/.test(character));
  if (suspiciousCharacters.length < 2) {
    return value;
  }

  const bytes: number[] = [];
  for (const character of value) {
    const byte = WINDOWS_1251_BYTES.get(character);
    if (byte === undefined) {
      return value;
    }
    bytes.push(byte);
  }
  const decoded = Buffer.from(bytes).toString("utf8");
  if (decoded.includes("�") || decoded === value) {
    return value;
  }

  recordNormalization(stats, "UTF-8 mojibake decoded");
  return decoded;
}

function normalizeText(value: string, stats: ImportStats): string {
  const decoded = normalizeMojibake(value, stats);
  const trimmed = decoded.trim();
  if (trimmed !== decoded) {
    recordNormalization(stats, "outer whitespace trimmed");
  }
  return trimmed;
}

function normalizeCity(value: string, domains: BaselineDomains, stats: ImportStats): string | null {
  const normalized = normalizeText(value, stats);
  if (domains.cities.has(normalized)) {
    return normalized;
  }

  const caseInsensitiveMatch = [...domains.cities].filter(
    (city) => city.toLocaleLowerCase("ru-RU") === normalized.toLocaleLowerCase("ru-RU"),
  );
  if (caseInsensitiveMatch.length === 1) {
    recordNormalization(stats, "city case normalized");
    return caseInsensitiveMatch[0];
  }

  return null;
}

function normalizeRating(value: string, stats: ImportStats): number | null | undefined {
  const normalized = value.trim();
  if (!normalized || normalized === "N/A") {
    recordNormalization(stats, "missing rating normalized to null");
    return null;
  }

  const decimal = /^\d+,\d+$/.test(normalized) ? normalized.replace(",", ".") : normalized;
  if (decimal !== normalized) {
    recordNormalization(stats, "decimal comma in rating normalized");
  }
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(decimal)) {
    return undefined;
  }

  const rating = Number(decimal);
  return Number.isFinite(rating) ? rating : undefined;
}

function normalizeReviewsCount(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const reviewsCount = Number(normalized);
  return Number.isSafeInteger(reviewsCount) ? reviewsCount : undefined;
}

function normalizeSite(value: string, stats: ImportStats): string | null | undefined {
  const normalized = normalizeText(value, stats);
  if (!normalized || normalized === "нет сайта") {
    if (!normalized) {
      recordNormalization(stats, "blank site normalized to null");
    }
    if (normalized === "нет сайта") {
      recordNormalization(stats, "site sentinel normalized to null");
    }
    return null;
  }

  const site = normalized.startsWith("htp://") ? `http://${normalized.slice(6)}` : normalized;
  if (site !== normalized) {
    recordNormalization(stats, "site protocol typo normalized");
  }

  try {
    const url = new URL(site);
    return url.protocol === "http:" || url.protocol === "https:" ? site : undefined;
  } catch {
    return undefined;
  }
}

function normalizePhone(value: string, stats: ImportStats): string | null | undefined {
  const phone = normalizeText(value, stats);
  if (!phone) {
    recordNormalization(stats, "blank phone normalized to null");
    return null;
  }
  return PHONE_PATTERN.test(phone) ? phone : undefined;
}

function toRawReviewRow(row: RawCsvRow): RawReviewRow {
  return {
    line: row.line,
    ...Object.fromEntries(CSV_HEADERS.map((header, index) => [header, row.values[index]])),
  } as RawReviewRow;
}

function rawRowsMatch(left: RawReviewRow, right: RawReviewRow): boolean {
  return CSV_HEADERS.every((header) => left[header] === right[header]);
}

function normalizeRow(
  row: RawReviewRow,
  domains: BaselineDomains,
  stats: ImportStats,
): Company | null {
  const id = normalizeText(row.id, stats);
  if (!SOURCE_ID_PATTERN.test(id)) {
    console.error(`Skip line ${row.line}: invalid source ID ${JSON.stringify(row.id)}`);
    return null;
  }
  if (Number(id.slice(2)) > domains.maxSourceId * 10) {
    stats.idRangeWarnings += 1;
    console.warn(`Warning at line ${row.line}: source ID is far outside the baseline range: ${id}`);
  }

  const city = normalizeCity(row.city, domains, stats);
  if (city === null) {
    console.error(`Skip line ${row.line}: city is outside the baseline domain: ${JSON.stringify(row.city)}`);
    return null;
  }

  const category = normalizeText(row.category, stats);
  if (!domains.categories.has(category)) {
    console.error(`Skip line ${row.line}: category is outside the baseline domain: ${JSON.stringify(row.category)}`);
    return null;
  }

  const rating = normalizeRating(row.rating, stats);
  if (rating === undefined) {
    console.error(`Skip line ${row.line}: invalid rating ${JSON.stringify(row.rating)}`);
    return null;
  }

  const reviewsCount = normalizeReviewsCount(row.reviews_count);
  if (reviewsCount === undefined) {
    console.error(`Skip line ${row.line}: invalid reviews_count ${JSON.stringify(row.reviews_count)}`);
    return null;
  }

  const site = normalizeSite(row.site, stats);
  if (site === undefined) {
    console.error(`Skip line ${row.line}: invalid site ${JSON.stringify(row.site)}`);
    return null;
  }

  const phone = normalizePhone(row.phone, stats);
  if (phone === undefined) {
    console.error(`Skip line ${row.line}: invalid phone ${JSON.stringify(row.phone)}`);
    return null;
  }

  const candidate = {
    id,
    name: normalizeText(row.name, stats),
    category,
    city,
    address: normalizeText(row.address, stats),
    rating,
    reviews_count: reviewsCount,
    site,
    phone,
  };
  const result = companySchema.safeParse(candidate);
  if (!result.success) {
    console.error(`Skip line ${row.line}: ${describeIssues(result.error.issues)}`);
    return null;
  }

  return result.data;
}

async function loadBaselineDomains(dataDirectory: string): Promise<BaselineDomains> {
  const pageFiles = (await readdir(dataDirectory))
    .filter((file) => PAGE_FILE_PATTERN.test(file))
    .sort();
  const cities = new Set<string>();
  const categories = new Set<string>();
  let maxSourceId = 0;

  for (const pageFile of pageFiles) {
    const page = JSON.parse(await readFile(path.join(dataDirectory, pageFile), "utf8")) as {
      items: Array<{ id: string; city: string; category: string }>;
    };
    for (const company of page.items) {
      cities.add(company.city);
      categories.add(company.category);
      if (SOURCE_ID_PATTERN.test(company.id)) {
        maxSourceId = Math.max(maxSourceId, Number(company.id.slice(2)));
      }
    }
  }

  return { cities, categories, maxSourceId };
}

function collectCompanies(rows: RawCsvRow[], domains: BaselineDomains, stats: ImportStats): Company[] {
  const [header, ...dataRows] = rows;
  if (!header || header.values.length !== CSV_HEADERS.length || !header.values.every((value, index) => value === CSV_HEADERS[index])) {
    throw new Error(`Unexpected CSV headers: ${JSON.stringify(header?.values ?? [])}`);
  }

  const uniqueRows = new Map<string, RawReviewRow>();
  const conflictingIds = new Set<string>();
  for (const row of dataRows) {
    stats.rawRows += 1;
    if (row.values.every((value) => value === "")) {
      stats.blankRows += 1;
      console.warn(`Skip blank line ${row.line}`);
      continue;
    }
    if (row.values.length !== CSV_HEADERS.length) {
      stats.malformedRows += 1;
      console.error(`Skip line ${row.line}: expected ${CSV_HEADERS.length} columns, got ${row.values.length}`);
      continue;
    }

    const reviewRow = toRawReviewRow(row);
    const previous = uniqueRows.get(reviewRow.id);
    if (!previous) {
      uniqueRows.set(reviewRow.id, reviewRow);
    } else if (rawRowsMatch(previous, reviewRow)) {
      stats.exactDuplicates += 1;
      console.warn(`Exact duplicate at line ${row.line}; first seen at line ${previous.line}`);
    } else {
      if (!conflictingIds.has(reviewRow.id)) {
        stats.conflictingIds += 1;
        conflictingIds.add(reviewRow.id);
        uniqueRows.delete(reviewRow.id);
        console.error(`Skip conflicting source ID ${JSON.stringify(reviewRow.id)} at lines ${previous.line} and ${row.line}`);
      }
    }
  }

  const companies: Company[] = [];
  for (const row of uniqueRows.values()) {
    if (conflictingIds.has(row.id)) {
      continue;
    }

    const company = normalizeRow(row, domains, stats);
    if (company) {
      companies.push(company);
    } else {
      stats.validationSkips += 1;
    }
  }
  stats.candidates = companies.length;
  return companies;
}

function companyValues(company: Company): (string | number | null)[] {
  return [
    company.id,
    company.name,
    company.category,
    company.city,
    company.address,
    company.rating,
    company.reviews_count,
    company.site,
    company.phone,
  ];
}

function makeUpsertQuery(companies: Company[]) {
  const values = companies.flatMap(companyValues);
  const placeholders = companies
    .map((_, rowIndex) => {
      const offset = rowIndex * COMPANY_COLUMNS.length;
      return `(${COMPANY_COLUMNS.map((_, index) => `$${offset + index + 1}`).join(", ")})`;
    })
    .join(", ");

  return {
    text: `
      INSERT INTO companies (${COMPANY_COLUMNS.join(", ")})
      VALUES ${placeholders}
      ON CONFLICT (source_id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        city = EXCLUDED.city,
        address = EXCLUDED.address,
        rating = EXCLUDED.rating,
        reviews_count = EXCLUDED.reviews_count,
        site = EXCLUDED.site,
        phone = EXCLUDED.phone
      RETURNING (xmax = 0) AS inserted
    `,
    values,
  };
}

async function upsertCompanies(companies: Company[], stats: ImportStats): Promise<void> {
  const pool = getDbPool();
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    for (let index = 0; index < companies.length; index += BATCH_SIZE) {
      const result = await client.query<{ inserted: boolean }>(
        makeUpsertQuery(companies.slice(index, index + BATCH_SIZE)),
      );
      for (const row of result.rows) {
        if (row.inserted) {
          stats.inserted += 1;
        } else {
          stats.updated += 1;
        }
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function printStats(stats: ImportStats): void {
  console.info("Review import completed");
  console.info(`Raw CSV data rows: ${stats.rawRows}`);
  console.info(`Blank rows skipped: ${stats.blankRows}`);
  console.info(`Malformed rows skipped: ${stats.malformedRows}`);
  console.info(`Exact duplicates: ${stats.exactDuplicates}`);
  console.info(`Conflicting IDs: ${stats.conflictingIds}`);
  console.info(`Validation skips: ${stats.validationSkips}`);
  console.info(`Validated candidates: ${stats.candidates}`);
  console.info(`Inserted: ${stats.inserted}`);
  console.info(`Updated: ${stats.updated}`);
  console.info(`ID range warnings: ${stats.idRangeWarnings}`);
  for (const [rule, count] of stats.normalizations) {
    console.info(`Normalized (${rule}): ${count}`);
  }
}

async function main(): Promise<void> {
  const dataDirectory = path.join(process.cwd(), "data");
  const csv = await readFile(path.join(dataDirectory, "review.csv"), "utf8");
  const stats: ImportStats = {
    rawRows: 0,
    blankRows: 0,
    malformedRows: 0,
    exactDuplicates: 0,
    conflictingIds: 0,
    validationSkips: 0,
    candidates: 0,
    inserted: 0,
    updated: 0,
    idRangeWarnings: 0,
    normalizations: new Map(),
  };
  const companies = collectCompanies(parseCsv(csv), await loadBaselineDomains(dataDirectory), stats);
  await upsertCompanies(companies, stats);
  printStats(stats);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Review import failed: ${message}`);
  process.exitCode = 1;
});
