/** Apply pending migrations. Run from CI or by hand; never on container start,
 *  so a migration failure is never mistaken for an app failure. */
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "../packages/core/src/db/index.ts";

const { db, sql } = createDb();
try {
  await migrate(db, { migrationsFolder: "db/migrations" });
  console.log("migrations applied");
} finally {
  await sql.end();
}
