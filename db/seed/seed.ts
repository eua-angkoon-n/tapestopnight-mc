/**
 * Seed the Desired Config from the pack's own server.properties.
 *
 * Values come from the pack (so the seeded config is byte-for-byte what the
 * modpack author shipped and tested); tiers come from packages/core config
 * TIERS, which is policy in source rather than data (ADR-0003).
 *
 * Idempotent: re-running updates tiers and reasons but never clobbers a value
 * an admin has since changed through the panel.
 */
import { readFileSync } from "node:fs";

import { sql as raw } from "drizzle-orm";

import { createDb, configKey, serverInfo } from "../../packages/core/src/db/index.ts";
import { parseProperties, tierFor } from "../../packages/core/src/config/index.ts";

const source = process.argv[2] ?? "/srv/mc/pack/server.properties.pack-original";
const props = parseProperties(readFileSync(source, "utf8"));
if (props.size === 0) throw new Error(`no properties parsed from ${source}`);

const { db, sql } = createDb();
try {
  let inserted = 0;
  let retiered = 0;

  for (const [key, value] of props) {
    const { tier, reason } = tierFor(key);
    const result = await db
      .insert(configKey)
      .values({ key, value, tier, reason, updatedBy: "seed" })
      .onConflictDoUpdate({
        target: configKey.key,
        // Deliberately does NOT touch `value`: an admin's change through the
        // panel is authoritative and re-seeding must not silently revert it.
        set: { tier: raw`excluded.tier`, reason: raw`excluded.reason` },
      })
      .returning({ key: configKey.key });
    if (result.length) retiered += 1;
    inserted += 1;
  }

  const locked = [...props.keys()].filter((k) => tierFor(k).tier === "LOCKED").length;
  const guarded = [...props.keys()].filter((k) => tierFor(k).tier === "GUARDED").length;
  const free = [...props.keys()].filter((k) => tierFor(k).tier === "FREE").length;

  await db
    .insert(serverInfo)
    .values({
      id: 1,
      modpackName: "RLCraft Dregora",
      modpackVersion: "v1.1.2b",
      minecraftVersion: "1.12.2",
      forgeVersion: "14.23.5.2860",
      serverAddress: "tapestopnight.com",
      updatedBy: "seed",
    })
    .onConflictDoNothing();

  console.log(`seeded ${inserted} config keys from ${source}`);
  console.log(`  LOCKED  ${locked}`);
  console.log(`  GUARDED ${guarded}`);
  console.log(`  FREE    ${free}`);
  console.log(`  (rows written/updated: ${retiered})`);
} finally {
  await sql.end();
}
