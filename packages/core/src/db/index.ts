import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.ts";

export * from "./schema.ts";

/**
 * One connection factory for every surface (web, bot, poller). Small pool:
 * this Host runs a 7 GB JVM alongside us and ADR-0012 leaves ~1.5 GB of
 * headroom in total, so idle connections are not free.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 5, idle_timeout: 30 });
  return { db: drizzle(sql, { schema }), sql };
}

export type Database = ReturnType<typeof createDb>["db"];
