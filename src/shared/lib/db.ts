import "server-only";

import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  polzaDbPool?: Pool;
};

export function getDbPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  if (!globalForDb.polzaDbPool) {
    globalForDb.polzaDbPool = new Pool({ connectionString });
  }

  return globalForDb.polzaDbPool;
}
