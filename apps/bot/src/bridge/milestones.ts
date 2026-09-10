/**
 * Finding what to congratulate people for.
 *
 * Reads the files the Game Server writes, in `PACK_DIR` which the bot already
 * mounts. Nothing here touches the pack: it only reads the world directory, so
 * `deploy/check-drift.sh` stays silent.
 *
 * ── Why a flush comes first ───────────────────────────────────────────────
 *
 * Better Questing writes `QuestProgress.json` when the world saves, not when a
 * quest completes. Measured on the Host: an RCON `save-all flush` moved the
 * file's mtime immediately, so a scan that flushes first sees a quest finished
 * seconds ago instead of one finished at the last autosave — the difference
 * between congratulating someone while they are still standing over the boss
 * and congratulating them after they have logged off.
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
  killCounts,
  nameCache,
  normaliseEntityId,
  questCompletions,
} from "@tapestopnight/core/bridge";

export interface MilestoneEvent {
  readonly mcName: string;
  /** "quest" or "kill" — which file it came from. */
  readonly kind: string;
  /** The quest id, or the entity id that was killed. */
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

/**
 * Everything a player has done that someone decided is worth announcing.
 *
 * The `notable_milestone` allowlist is applied HERE rather than at announce
 * time, on purpose. Dregora has 403 quests and the statistics file counts every
 * entity ever killed; recording all of it would fill `player_milestone` with
 * rows nobody will ever read, and — worse — would mean that adding a quest to
 * the allowlist later announces nothing, because it was already recorded as
 * seen. Only notable things are tracked, so the allowlist stays the only
 * decision.
 */
export async function scanMilestones(
  db: Database,
  worldDir: string,
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
  // way a human reads it off a quest definition (`lycanitesmobs:asmodeus`)
  // while the statistics file spells it with a dot.
  const labels = new Map(
    notable.map((n) => [
      n.kind === "kill" ? `kill:${normaliseEntityId(n.key)}` : `${n.kind}:${n.key}`,
      n.label,
    ]),
  );
  const names = nameCache(await readJson(join(worldDir, "betterquesting", "NameCache.json")));
  const found: MilestoneEvent[] = [];

  // ── quests ────────────────────────────────────────────────────────────
  const progress = await readJson(join(worldDir, "betterquesting", "QuestProgress.json"));
  for (const completion of questCompletions(progress)) {
    const label = labels.get(`quest:${completion.questId}`);
    const mcName = names[completion.uuid];
    if (label && mcName) found.push({ mcName, kind: "quest", key: completion.questId, label });
  }

  // ── kills ─────────────────────────────────────────────────────────────
  //
  // The only route to a Lycanites or Battle Towers boss: neither ships an
  // advancement (and advancements are switched off on this pack anyway), and
  // neither writes anything to the log when its boss dies.
  let statFiles: string[] = [];
  try {
    statFiles = (await readdir(join(worldDir, "stats"))).filter((f) => f.endsWith(".json"));
  } catch {
    statFiles = [];
  }

  for (const file of statFiles) {
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
