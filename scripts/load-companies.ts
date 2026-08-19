import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { companyPageSchema, companySchema, type Company } from "./company-import-schema";
import { getDbPool } from "../src/shared/lib/db-pool";

const BATCH_SIZE = 500;
const PAGE_FILE_PATTERN = /^page_(\d+)\.json$/;
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

type SourceLocation = {
  file: string;
  page: number;
  row: number;
};

type SourceCompany = {
  company: Company;
  location: SourceLocation;
};

type ImportStats = {
  rawRecords: number;
  validRecords: number;
  exactDuplicates: number;
  validationSkips: number;
};

function describeLocation(location: SourceLocation): string {
  return `${location.file} (page ${location.page}, row ${location.row})`;
}

function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.map(String).join(".") || "record"}: ${issue.message}`)
    .join("; ");
}

function companiesMatch(left: Company, right: Company): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.category === right.category &&
    left.city === right.city &&
    left.address === right.address &&
    left.rating === right.rating &&
    left.reviews_count === right.reviews_count &&
    left.site === right.site &&
    left.phone === right.phone
  );
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
      const rowOffset = rowIndex * COMPANY_COLUMNS.length;
      const rowPlaceholders = COMPANY_COLUMNS.map((_, columnIndex) => `$${rowOffset + columnIndex + 1}`);

      return `(${rowPlaceholders.join(", ")})`;
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
    `,
    values,
  };
}

async function discoverPageFiles(dataDirectory: string): Promise<{ file: string; page: number }[]> {
  const directoryEntries = await readdir(dataDirectory, { withFileTypes: true });
  const pageFiles = directoryEntries.flatMap((entry) => {
    const match = entry.isFile() ? PAGE_FILE_PATTERN.exec(entry.name) : null;

    return match ? [{ file: entry.name, page: Number(match[1]) }] : [];
  });

  if (pageFiles.length === 0) {
    throw new Error(`No page_*.json files found in ${dataDirectory}`);
  }

  return pageFiles.sort((left, right) => left.page - right.page || left.file.localeCompare(right.file));
}

async function collectCompanies(dataDirectory: string) {
  const pages = await discoverPageFiles(dataDirectory);
  const cleanCompanies = new Map<string, SourceCompany>();
  const conflicts = new Map<string, SourceCompany[]>();
  const stats: ImportStats = {
    rawRecords: 0,
    validRecords: 0,
    exactDuplicates: 0,
    validationSkips: 0,
  };
  let expectedPerPage: number | undefined;
  let expectedTotal: number | undefined;

  for (const [index, pageFile] of pages.entries()) {
    const expectedPage = index + 1;
    if (pageFile.page !== expectedPage) {
      throw new Error(
        `Page files are not continuous: expected page ${expectedPage}, found ${pageFile.file}`,
      );
    }

    const filePath = path.join(dataDirectory, pageFile.file);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot parse ${pageFile.file}: ${message}`);
    }

    const pageResult = companyPageSchema.safeParse(parsedJson);
    if (!pageResult.success) {
      throw new Error(`Invalid page envelope in ${pageFile.file}: ${describeIssues(pageResult.error.issues)}`);
    }

    const page = pageResult.data;
    if (page.page !== pageFile.page) {
      throw new Error(`Page metadata mismatch in ${pageFile.file}: expected page ${pageFile.page}, got ${page.page}`);
    }

    if (expectedPerPage === undefined) {
      expectedPerPage = page.per_page;
      expectedTotal = page.total;
    } else if (page.per_page !== expectedPerPage || page.total !== expectedTotal) {
      throw new Error(`Inconsistent metadata in ${pageFile.file}: per_page and total must match prior pages`);
    }

    const expectedPageCount = Math.ceil(page.total / page.per_page);
    if (pages.length !== expectedPageCount) {
      throw new Error(`Page file count mismatch: expected ${expectedPageCount}, found ${pages.length}`);
    }

    const expectedItems = Math.min(page.per_page, page.total - (page.page - 1) * page.per_page);
    if (page.items.length !== expectedItems) {
      throw new Error(`Item count mismatch in ${pageFile.file}: expected ${expectedItems}, found ${page.items.length}`);
    }

    stats.rawRecords += page.items.length;

    for (const [rowIndex, item] of page.items.entries()) {
      const location = { file: pageFile.file, page: page.page, row: rowIndex + 1 };
      const companyResult = companySchema.safeParse(item);
      if (!companyResult.success) {
        stats.validationSkips += 1;
        console.error(`Validation skip at ${describeLocation(location)}: ${describeIssues(companyResult.error.issues)}`);
        continue;
      }

      stats.validRecords += 1;
      const sourceCompany = { company: companyResult.data, location };
      const sourceId = sourceCompany.company.id;
      const conflict = conflicts.get(sourceId);
      if (conflict) {
        conflict.push(sourceCompany);
        continue;
      }

      const previous = cleanCompanies.get(sourceId);
      if (!previous) {
        cleanCompanies.set(sourceId, sourceCompany);
      } else if (companiesMatch(previous.company, sourceCompany.company)) {
        stats.exactDuplicates += 1;
        console.info(
          `Exact duplicate ${sourceId}: ${describeLocation(sourceCompany.location)} duplicates ${describeLocation(previous.location)}`,
        );
      } else {
        cleanCompanies.delete(sourceId);
        conflicts.set(sourceId, [previous, sourceCompany]);
      }
    }
  }

  if (stats.rawRecords !== expectedTotal) {
    throw new Error(`Raw record count mismatch: expected ${expectedTotal}, found ${stats.rawRecords}`);
  }

  for (const [sourceId, versions] of conflicts) {
    console.error(`Conflicting source ID ${sourceId}:`);
    for (const version of versions) {
      console.error(`  ${describeLocation(version.location)}: ${JSON.stringify(version.company)}`);
    }
  }

  return { pages: pages.length, cleanCompanies, conflicts, stats };
}

async function upsertCompanies(companies: Company[]): Promise<number> {
  const pool = getDbPool();
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    let upsertedRows = 0;

    for (let index = 0; index < companies.length; index += BATCH_SIZE) {
      const batch = companies.slice(index, index + BATCH_SIZE);
      const result = await client.query(makeUpsertQuery(batch));
      upsertedRows += result.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return upsertedRows;
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

async function main(): Promise<void> {
  const dataDirectory = path.join(process.cwd(), "data");
  const { pages, cleanCompanies, conflicts, stats } = await collectCompanies(dataDirectory);
  const upsertedRows = await upsertCompanies([...cleanCompanies.values()].map(({ company }) => company));

  console.info("Companies import completed");
  console.info(`Pages: ${pages}`);
  console.info(`Raw records: ${stats.rawRecords}`);
  console.info(`Valid records: ${stats.validRecords}`);
  console.info(`Clean unique companies: ${cleanCompanies.size}`);
  console.info(`Exact duplicates: ${stats.exactDuplicates}`);
  console.info(`Conflicting IDs: ${conflicts.size}`);
  console.info(`Validation skips: ${stats.validationSkips}`);
  console.info(`Rows upserted: ${upsertedRows}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Companies import failed: ${message}`);
  process.exitCode = 1;
});
