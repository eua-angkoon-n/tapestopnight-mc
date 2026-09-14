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

import { notInArray, sql as raw } from "drizzle-orm";

import { createDb, configKey, serverInfo } from "../../packages/core/src/db/index.ts";
import { parseProperties, tierFor } from "../../packages/core/src/config/index.ts";
import { packIdentity } from "./pack-identity.ts";
import { DEPLOYMENT_OVERRIDES, seededValue } from "./deployment-overrides.ts";

const args = process.argv.slice(2).filter((a) => a !== "--prune");
const prune = process.argv.includes("--prune");
const source = args[0] ?? "/srv/mc/pack/server.properties.pack-original";
const props = parseProperties(readFileSync(source, "utf8"));
if (props.size === 0) throw new Error(`no properties parsed from ${source}`);

const { db, sql } = createDb();
try {
  let inserted = 0;
  let retiered = 0;

  for (const [key, packValue] of props) {
    const { tier, reason } = tierFor(key);
    const value = seededValue(key, packValue);
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

  /*
    Keys this pack does not have.

    The renderer writes EVERY row in config_key to server.properties without
    filtering (render.ts), so a key left behind by a previous modpack keeps
    being rendered onto a server that has never heard of it. Dregora's
    `level-type=OTG` and `hellworld` are the reason this exists: on Homestead
    the first names a world generator that is not installed and the second is
    not a property at all.

    Reported by default and only deleted with --prune, because "every row the
    pack file does not mention" is a wide net — a key added deliberately after
    seeding would be caught by it too, and losing one silently is worse than
    printing a list somebody has to read.
  */
  const stale = await db
    .select({ key: configKey.key })
    .from(configKey)
    .where(notInArray(configKey.key, [...props.keys()]));

  if (stale.length) {
    const names = stale.map((r) => r.key).join(", ");
    if (prune) {
      await db.delete(configKey).where(notInArray(configKey.key, [...props.keys()]));
      console.log(`pruned ${stale.length} key(s) absent from ${source}: ${names}`);
    } else {
      console.log(`\n⚠ ${stale.length} key(s) in the database are absent from ${source}:`);
      console.log(`    ${names}`);
      console.log("  These are still rendered into server.properties.");
      console.log("  Re-run with --prune to delete them.\n");
    }
  }

  for (const [key, o] of Object.entries(DEPLOYMENT_OVERRIDES)) {
    if (props.has(key)) console.log(`overrode ${key}=${props.get(key)} -> ${o.value}  (${o.why})`);
  }

  const locked = [...props.keys()].filter((k) => tierFor(k).tier === "LOCKED").length;
  const guarded = [...props.keys()].filter((k) => tierFor(k).tier === "GUARDED").length;
  const free = [...props.keys()].filter((k) => tierFor(k).tier === "FREE").length;

  /*
    Which half of this row the seed owns.

    Everything that describes the PACK is seeded and re-seeded: the admin panel
    has no input for any of it (config-actions.ts writes only the icon), so
    there is no admin edit to protect and leaving it on conflict-do-nothing is
    how the row went on saying "RLCraft Dregora" after the pack had changed.

    Everything the operator owns — serverAddress, discordUrl, the icon,
    rulesMarkdown — is written once and never overwritten. discordUrl is
    deliberately absent: an invite is not something a seed file can know, and
    the page already degrades to an honest note rather than a dead button.
  */
  const pack = packIdentity();

  await db
    .insert(serverInfo)
    .values({ id: 1, ...pack, serverAddress: "tapestopnight.com", updatedBy: "seed" })
    .onConflictDoUpdate({
      target: serverInfo.id,
      set: { ...pack, updatedBy: "seed", updatedAt: raw`now()` },
    });

  console.log(`seeded ${inserted} config keys from ${source}`);
  console.log(`  LOCKED  ${locked}`);
  console.log(`  GUARDED ${guarded}`);
  console.log(`  FREE    ${free}`);
  console.log(`  (rows written/updated: ${retiered})`);
} finally {
  await sql.end();
}
