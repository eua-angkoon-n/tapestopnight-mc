/**
 * Reading what players have achieved out of the files the Game Server writes.
 *
 * ── Why advancements, now ─────────────────────────────────────────────────
 *
 * They used to be unavailable. Dregora shipped
 * `config/fermiummixins.cfg` with `"Nuke Advancements (Vanilla)"=true`, which
 * stopped the advancement system loading at all to save memory, and the empty
 * `DregoraRL/advancements/*.json` on the Host confirmed it. The milestone
 * reader therefore went to Better Questing and the vanilla statistics file
 * instead.
 *
 * Homestead disables nothing of the sort, so `<world>/advancements/<uuid>.json`
 * is populated and is the natural source: it covers vanilla progression and
 * anything the pack's own datapacks add, in one place, with no mod-specific
 * parsing.
 *
 * ── Why files and not the log line ────────────────────────────────────────
 *
 * 1.20.1 does print "X has made the advancement [Y]", and the Chat Bridge is
 * already tailing that log, so reading it there looks cheaper. It is worse:
 * the log only says what happened while somebody was watching. A bot restart,
 * a log rotation or a few minutes of downtime and the announcement is gone for
 * good. The files are state, not events — a scan that runs late still sees
 * everything — and the `player_milestone` table already exists to make a
 * repeated read idempotent. It also means nothing here depends on the exact
 * shape of a log line, or on the `announceAdvancements` gamerule being on.
 *
 * These functions take already-parsed JSON so they can be tested against a
 * fixture. Reading and scheduling belong to the caller.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every advancement one player has finished, from their `advancements/<uuid>.json`.
 *
 * The file is a flat map of advancement id to progress, plus a `DataVersion`
 * integer that is not an advancement and has to be skipped. An entry counts
 * only when `done` is exactly true; a partially-completed advancement is
 * present in the file with `done: false` and its criteria half-filled, and
 * announcing that would congratulate somebody for starting.
 *
 * Recipe unlocks are excluded. Vanilla writes one `minecraft:recipes/...`
 * entry per recipe a player has unlocked — hundreds of them, none of which any
 * human would call an achievement. They cannot reach the allowlist by accident
 * anyway, but skipping them here keeps the scan from walking a list that is
 * two orders of magnitude longer than the interesting one.
 */
export function advancementsDone(progress: unknown): string[] {
  if (!isRecord(progress)) return [];

  const out: string[] = [];
  for (const [id, entry] of Object.entries(progress)) {
    if (!isRecord(entry)) continue; // DataVersion, and anything else unexpected
    if (id.startsWith("minecraft:recipes/")) continue;
    if (entry["done"] === true) out.push(id);
  }
  return out;
}

/**
 * One entity id, in a form that compares equal however it was spelled.
 *
 * The allowlist is written by a human reading an id off a wiki, who may well
 * type `minecraft:zombie`, while historic seed data used the dotted spelling
 * 1.12.2 wrote into its statistics keys. Normalising both sides removes an
 * entire category of "the seed looks right but nothing ever matches".
 */
export function normaliseEntityId(id: string): string {
  return id.replace(/:/g, ".").toLowerCase();
}

/**
 * `minecraft:killed` counters out of one player's statistics file, keyed by
 * normalised entity id.
 *
 * This is the route to something the pack ships no advancement for. Note the
 * shape: 1.12.2 wrote flat keys like `stat.killEntity.minecraft.zombie`, and
 * 1.13 replaced the whole file with `{"stats": {"minecraft:killed": {...}}}`.
 * The old reader did not throw on the new format — it returned nothing at all,
 * which is the failure mode worth being careful about here.
 */
export function killCounts(stats: unknown): Record<string, number> {
  if (!isRecord(stats)) return {};

  const inner = stats["stats"];
  const killed = isRecord(inner) ? inner["minecraft:killed"] : undefined;
  if (!isRecord(killed)) return {};

  const out: Record<string, number> = {};
  for (const [entity, value] of Object.entries(killed)) {
    if (typeof value !== "number" || value <= 0) continue;
    out[normaliseEntityId(entity)] = value;
  }
  return out;
}

/**
 * `usercache.json` — the server's own map from a player UUID to a name.
 *
 * Lives beside the jar rather than inside the world, so the caller passes the
 * pack directory for this one and the world directory for everything else.
 * Replaces Better Questing's `NameCache.json`, which does not exist here.
 *
 * Vanilla writes an array of `{name, uuid, expiresOn}`. Expired entries are
 * kept: the cache expiry governs whether the server trusts the name for a
 * lookup, and we are naming somebody in a Discord message, where a slightly
 * stale name beats no announcement.
 */
export function nameCache(cache: unknown): Record<string, string> {
  if (!Array.isArray(cache)) return {};

  const out: Record<string, string> = {};
  for (const entry of cache) {
    if (!isRecord(entry)) continue;
    const uuid = entry["uuid"];
    const name = entry["name"];
    if (typeof uuid === "string" && typeof name === "string") out[uuid.toLowerCase()] = name;
  }
  return out;
}
