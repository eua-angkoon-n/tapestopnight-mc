/**
 * Finding what to congratulate people for.
 *
 * Reads the files the Game Server writes, in `PACK_DIR` which the bot already
 * mounts. Nothing here touches the pack: it only reads the world directory and
 * `usercache.json`, so `deploy/check-drift.sh` stays silent.
 *
 * ── Why a flush comes first ───────────────────────────────────────────────
 *
 * The server writes advancement and statistics files when the world saves, not
 * at the moment a player finishes something. An RCON `save-all flush` moves
 * their mtime immediately, so a scan that flushes first sees something
 * finished seconds ago instead of at the last autosave — the difference
 * between congratulating somebody while they are still standing there and
 * congratulating them after they have logged off.
 *
 * The flush is best-effort. `max-tick-time=-1` means the Game Server may be
 * mid-generation and unreachable, and that is not a reason to skip the scan —
 * the files on disk are still readable, just older.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { notableMilestone, type Database } from "@tapestopnight/core/db";
import { withRcon, type RconOptions } from "@tapestopnight/core/control";
import {
  advancementsDone,
  killCounts,
  nameCache,
  normaliseEntityId,
} from "@tapestopnight/core/bridge";

export interface MilestoneEvent {
  readonly mcName: string;
  /** "advancement" or "kill" — which file it came from. */
  readonly kind: string;
  /** The advancement id, or the entity id that was killed. */
  readonly key: string;
  /** What Discord is told, in Thai, from `notable_milestone`. */
  readonly label: string;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // A missing or half-written file is normal: the server rewrites these
    // during a save, and a fresh world has no stats directory at all.
    return null;
  }
}

async function jsonFilesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/**
 * Everything a player has done that someone decided is worth announcing.
 *
 * The `notable_milestone` allowlist is applied HERE rather than at announce
 * time, on purpose. Vanilla 1.20.1 alone has over a hundred advancements
 * before Homestead's own datapacks add more, and the statistics file counts
 * every entity ever killed; recording all of it would fill `player_milestone`
 * with rows nobody will ever read, and — worse — would mean that adding an
 * advancement to the allowlist later announces nothing, because it was already
 * recorded as seen. Only notable things are tracked, so the allowlist stays
 * the only decision.
 *
 * `packDir` is separate from `worldDir` because `usercache.json` is not part
 * of the world: it sits beside the server jar and survives a world reset.
 */
export async function scanMilestones(
  db: Database,
  worldDir: string,
  packDir: string,
  rcon: RconOptions,
): Promise<MilestoneEvent[]> {
  await withRcon(rcon, (run) => run("save-all flush")).catch(() => {
    /* unreachable Game Server — read the older files rather than skip */
  });

  const notable = await db
    .select({
      kind: notableMilestone.kind,
      key: notableMilestone.key,
      label: notableMilestone.label,
    })
    .from(notableMilestone)
    .where(eq(notableMilestone.enabled, true));
  if (notable.length === 0) return [];

  // Kill keys are normalised on BOTH sides so the allowlist can be written the
  // way a human reads it off a wiki page (`minecraft:zombie`) whatever spelling
  // the statistics file happens to use.
  const labels = new Map(
    notable.map((n) => [
      n.kind === "kill" ? `kill:${normaliseEntityId(n.key)}` : `${n.kind}:${n.key}`,
      n.label,
    ]),
  );
  const names = nameCache(await readJson(join(packDir, "usercache.json")));
  const found: MilestoneEvent[] = [];

  // ── advancements ──────────────────────────────────────────────────────
  //
  // One file per player, named by UUID, so the player is known from the
  // filename and no separate ownership lookup is needed.
  for (const file of await jsonFilesIn(join(worldDir, "advancements"))) {
    const uuid = file.replace(/\.json$/, "").toLowerCase();
    const mcName = names[uuid];
    if (!mcName) continue;

    for (const id of advancementsDone(await readJson(join(worldDir, "advancements", file)))) {
      const label = labels.get(`advancement:${id}`);
      if (label) found.push({ mcName, kind: "advancement", key: id, label });
    }
  }

  // ── kills ─────────────────────────────────────────────────────────────
  //
  // The route to something the pack ships no advancement for — a modded boss
  // that dies without printing anything anywhere.
  for (const file of await jsonFilesIn(join(worldDir, "stats"))) {
    const uuid = file.replace(/\.json$/, "").toLowerCase();
    const mcName = names[uuid];
    if (!mcName) continue;

    for (const [entity, count] of Object.entries(
      killCounts(await readJson(join(worldDir, "stats", file))),
    )) {
      if (count <= 0) continue;
      const label = labels.get(`kill:${entity}`);
      if (label) found.push({ mcName, kind: "kill", key: entity, label });
    }
  }

  return found;
}
