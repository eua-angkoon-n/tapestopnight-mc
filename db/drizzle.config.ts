import type { Config } from "drizzle-kit";

export default {
  schema: "./packages/core/src/db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
} satisfies Config;
