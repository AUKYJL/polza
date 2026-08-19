import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDbPool } from "../src/shared/lib/db-pool";

async function main(): Promise<void> {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schemaSql = await readFile(schemaPath, "utf8");
  const pool = getDbPool();

  try {
    await pool.query(schemaSql);
    console.info("Database schema applied");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Database schema setup failed: ${message}`);
  process.exitCode = 1;
});
