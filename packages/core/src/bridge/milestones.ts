/**
 * Reading what players have achieved out of the files the Game Server writes.
 *
 * ── Why not advancements ──────────────────────────────────────────────────
 *
 * They do not exist on this pack. `config/fermiummixins.cfg` ships
 * `"Nuke Advancements (Vanilla)"=true`, which stops the advancement system
 * loading at all to save memory, and the empty `DregoraRL/advancements/*.json`
 * on the Host confirms it. The `announceAdvancements=true` gamerule is
 * therefore announcing nothing, and any design that waits for
 * "X has made the advancement [Y]" in the log waits forever.
 *
 * What Dregora actually uses is Better Questing — 403 quests including the
 * boss fights (Asmodeus, Amalgalich, Rahovart, the Four Towers) — plus the
 * vanilla statistics file, which counts every entity a player has killed
 * whether or not any quest asks about it. Those two are the sources here.
 *
 * These functions take already-parsed JSON so they can be tested against a
 * fixture. Reading and scheduling belong to the caller.
 *
 * ── The shape of Better Questing's files ──────────────────────────────────
 *
 * NBT-flavoured JSON: every key carries a `:<type>` suffix (`questID:3` is an
 * int, `uuid:8` a string, `completed:9` a list). The suffixes are part of the
 * key, not decoration, and the layout has changed between BQ versions — so
 * everything below reads defensively and returns nothing rather than throwing
 * when a shape is unfamiliar. A milestone reader that crashes takes the chat
 * bridge down with it, and a missed congratulation is not worth that.
 */

/** A completion, before anyone has decided whether it is worth announcing. */
export interface QuestCompletion {
  readonly questId: string;
  readonly uuid: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Any UUID-valued field, wherever in the entry BQ chose to put it this version. */
function uuidsIn(value: unknown): string[] {
  if (typeof value === "string") return UUID.test(value) ? [value.toLowerCase()] : [];
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(uuidsIn);
}

/**
 * Every (quest, player) pair marked complete in `QuestProgress.json`.
 *
 * The quest id is read from `questID:3` when present and otherwise from the
 * entry's own key, which is the `"<id>:10"` index BQ writes.
 */
export function questCompletions(progress: unknown): QuestCompletion[] {
  if (!isRecord(progress)) return [];
  const entries = progress["questProgress:9"];
  if (!isRecord(entries)) return [];

  const out: QuestCompletion[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (!isRecord(entry)) continue;

    const rawId = entry["questID:3"];
    const questId = typeof rawId === "number" ? String(rawId) : (key.split(":")[0] ?? key);

    for (const uuid of uuidsIn(entry["completed:9"])) {
      out.push({ questId, uuid });
    }
  }
  return out;
}

/**
 * One entity id, in a form that compares equal however it was spelled.
 *
 * Minecraft 1.12.2 writes a registry name into a statistics key with the colon
 * replaced by a dot — the Host's file has `stat.mineBlock.traverse.dead_grass`,
 * not `traverse:dead_grass`. Mods are not perfectly consistent about it, and
 * the allowlist is written by a human reading `lycanitesmobs:asmodeus` off a
 * quest definition. Normalising both sides removes an entire category of
 * "the seed looks right but nothing ever matches".
 */
export function normaliseEntityId(id: string): string {
  return id.replace(/:/g, ".").toLowerCase();
}

/**
 * `stat.killEntity.<entity>` counters out of one player's statistics file,
 * keyed by normalised entity id.
 *
 * This is the route to a boss that nobody took the quest for. Neither
 * Lycanites nor Battle Towers ships an advancement — and advancements are
 * switched off on this pack anyway — and neither writes anything to the log
 * when its boss dies.
 */
export function killCounts(stats: unknown): Record<string, number> {
  if (!isRecord(stats)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== "number" || value <= 0) continue;
    if (!key.startsWith("stat.killEntity.")) continue;
    out[normaliseEntityId(key.slice("stat.killEntity.".length))] = value;
  }
  return out;
}

/** `NameCache.json` — the only server-side map from a player UUID to a name. */
export function nameCache(cache: unknown): Record<string, string> {
  if (!isRecord(cache)) return {};
  const entries = cache["nameCache:9"];
  if (!isRecord(entries)) return {};

  const out: Record<string, string> = {};
  for (const entry of Object.values(entries)) {
    if (!isRecord(entry)) continue;
    const uuid = entry["uuid:8"];
    const name = entry["name:8"];
    if (typeof uuid === "string" && typeof name === "string") out[uuid.toLowerCase()] = name;
  }
  return out;
}
