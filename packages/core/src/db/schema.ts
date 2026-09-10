import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Raw bytes. postgres-js hands bytea back as a Buffer and takes one on write. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Edit Tier — ADR-0003.
 *
 * Decides whether and how the admin UI may change a config key. Unknown keys
 * default to LOCKED, so introducing a key can never silently open a hole.
 *
 * How each tier is expressed in the UI is ADR-0007: the difference is
 * structural, not just colour. A LOCKED key is not rendered as an input at
 * all — not a disabled one — so it cannot be focused, tabbed to, or submitted
 * even through a bug.
 */
export const editTier = pgEnum("edit_tier", ["FREE", "GUARDED", "LOCKED"]);

/**
 * The Desired Config: the authoritative configuration (ADR-0002).
 *
 * server.properties on disk is generated FROM this table and owned by nobody.
 * Never the other way round.
 */
export const configKey = pgTable("config_key", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  tier: editTier("tier").notNull().default("LOCKED"),
  /**
   * Shown to the admin next to the field. For a LOCKED key this is the
   * answer to "why can't I change this?" — ADR-0003 keeps locked keys
   * visible precisely so nobody goes hunting for them over SSH.
   */
  reason: text("reason"),
  /** Discord snowflake. Text, not bigint: snowflakes exceed JS number safety. */
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only audit trail. The thing a file on disk cannot give us (ADR-0002). */
export const configHistory = pgTable("config_history", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ADR-0004 break-glass ONLY.
 *
 * Admin authority is a Discord guild role. This table exists so a Discord
 * outage or a role misconfiguration cannot lock everyone out of their own
 * control plane. Routine administration must never touch it.
 */
export const adminAllowlist = pgTable("admin_allowlist", {
  discordId: text("discord_id").primaryKey(),
  note: text("note"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Requirement 3.3: the bot answers only in these channels. */
export const allowedChannel = pgTable("allowed_channel", {
  channelId: text("channel_id").primaryKey(),
  note: text("note"),
  /** When false the row is kept for the record but stops granting access. */
  enabled: boolean("enabled").notNull().default(true),
});

/** Requirement 2.3: what the public info pages display. */
export const serverInfo = pgTable("server_info", {
  id: integer("id").primaryKey().default(1),
  modpackName: text("modpack_name").notNull(),
  modpackVersion: text("modpack_version").notNull(),
  minecraftVersion: text("minecraft_version").notNull(),
  forgeVersion: text("forge_version").notNull(),
  /** What a player types. The SRV record makes this the bare apex (ADR-0001). */
  serverAddress: text("server_address").notNull(),
  downloadUrl: text("download_url"),

  /**
   * Where the public pages send players next.
   *
   * Here rather than hardcoded in the page, for the same reason the modpack
   * version is: the bot answers `/info` from this row too, so a literal in the
   * JSX would be a second copy that nobody remembers to update. A Discord
   * invite in particular expires or gets rotated.
   *
   * Both are nullable and the page degrades to an honest "not set yet" note
   * rather than a dead button, exactly as `downloadUrl` already does.
   */
  discordUrl: text("discord_url"),
  wikiUrl: text("wiki_url"),

  /**
   * The Server Icon, held here rather than as files on disk - ADR-0002 applied
   * to something that is not a properties key.
   *
   * `iconSource` is the admin's high-resolution upload: Desired Config, and the
   * image the public hero renders. `icon64` is the exact 64x64 PNG derived from
   * it, which Apply materialises to /pack/server-icon.png. That file is
   * Rendered Config - disposable, owned by nobody, overwritten on every Apply.
   *
   * Why not a volume: /srv/mc/pack is vendor payload that check-drift.sh
   * compares against (verified zip + overlay), so an upload dropped in there
   * would be reported as drift forever. A new named volume would need its own
   * backup story; Postgres already has one. These images are hundreds of KB.
   *
   * `iconSourceSha256` is the ETag for the public route, and what
   * config_history records - the trail should say the icon changed, not carry
   * the icon.
   */
  iconSource: bytea("icon_source"),
  iconSourceMime: text("icon_source_mime"),
  iconSourceSha256: text("icon_source_sha256"),
  icon64: bytea("icon_64"),
  iconUpdatedBy: text("icon_updated_by"),
  iconUpdatedAt: timestamp("icon_updated_at", { withTimezone: true }),

  rulesMarkdown: text("rules_markdown"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Written by the single Status Poller, read by everyone.
 *
 * If each web request probed the Game Server directly, 50 concurrent visitors
 * would mean 50 probes. The Game Server sees constant load regardless of how
 * many people are watching.
 */
export const serverStatusCache = pgTable("server_status_cache", {
  id: integer("id").primaryKey().default(1),
  online: boolean("online").notNull(),
  playersOnline: integer("players_online"),
  playersMax: integer("players_max"),
  /** Sample of player names from Server List Ping — not the full roster. */
  sample: jsonb("sample").$type<string[]>(),
  motd: text("motd"),
  /**
   * Survives going offline, so the public page can say "last seen 2 hours
   * ago" instead of rendering an empty box.
   */
  lastSeenOnline: timestamp("last_seen_online", { withTimezone: true }),
  /**
   * Container state, independent of the ping. Offline is concluded from this
   * plus a TCP probe — NEVER from an RCON or ping timeout, because a
   * legitimate OTG generation hang looks identical and max-tick-time=-1 makes
   * those hangs a normal part of this modpack.
   */
  containerState: text("container_state"),
  probedAt: timestamp("probed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ── The Chat Bridge ───────────────────────────────────────────────────────
 *
 * Where a message came from. The value decides which deliveries are already
 * satisfied at insert time: a `game` row is by definition already in the game,
 * a `discord` row is already in Discord. Nothing re-delivers a message to the
 * place it came from, which is how the bridge avoids echoing itself.
 */
export const chatSource = pgEnum("chat_source", ["game", "web", "discord"]);

/**
 * Every message that crosses the bridge, in one table.
 *
 * One spine rather than three point-to-point paths. The Game Server is reached
 * ONLY by the bot draining this table over RCON — the web app must never open
 * an RCON connection inside a request, because `max-tick-time=-1` means OTG can
 * legitimately block the main thread for minutes (README rule 3) and the chat
 * box would hang indistinguishably from being broken.
 */
export const chatMessage = pgTable(
  "chat_message",
  {
    id: serial("id").primaryKey(),
    source: chatSource("source").notNull(),
    /** Shown to everyone: the Minecraft name for game and web, the Discord display name otherwise. */
    authorName: text("author_name").notNull(),
    /** Discord snowflake. Text, not bigint: snowflakes exceed JS number safety. */
    authorDiscordId: text("author_discord_id"),
    body: text("body").notNull(),
    deliveredToGame: boolean("delivered_to_game").notNull().default(false),
    deliveredToDiscord: boolean("delivered_to_discord").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The web polls `?after=<id>`; the bot's drain loop scans for the two
    // false flags. Both are the whole read pattern of this table.
    index("chat_message_pending_idx").on(t.deliveredToGame, t.deliveredToDiscord),
  ],
);

/**
 * Which Discord channels the bridge uses — deliberately NOT `allowed_channel`.
 *
 * `allowed_channel` answers "where does the bot accept COMMANDS". This answers
 * "which channel mirrors the game". Reusing one table for both would pour every
 * in-game line into the admin command channel, which is the sort of mistake
 * that is obvious in hindsight and invisible in a schema.
 *
 * Fails closed the same way: with no rows, nothing is mirrored anywhere.
 */
export const bridgeChannelKind = pgEnum("bridge_channel_kind", ["chat", "milestone"]);

export const bridgeChannel = pgTable(
  "bridge_channel",
  {
    channelId: text("channel_id").notNull(),
    kind: bridgeChannelKind("kind").notNull(),
    note: text("note"),
    /** When false the row is kept for the record but stops being used. */
    enabled: boolean("enabled").notNull().default(true),
  },
  // Keyed by (channel, kind), not by channel alone. One channel carrying both
  // the conversation and the congratulations is a normal way to run a small
  // server — the first draft keyed on the channel and could not express it.
  (t) => [primaryKey({ columns: [t.channelId, t.kind] })],
);

/**
 * Discord account ↔ Minecraft name.
 *
 * `discordId` is unique as well as `mcName` being the key: one person, one
 * character. Re-linking is a delete then an insert, never two live rows, so
 * "who is this message from" always has exactly one answer.
 *
 * → ADR-0016 for why IP matching is the primary path and what it cannot do.
 */
export const linkVia = pgEnum("link_via", ["ip", "code"]);

export const playerLink = pgTable("player_link", {
  mcName: text("mc_name").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  linkedVia: linkVia("linked_via").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Addresses seen logging in, harvested from the Game Server log.
 *
 * Kept per (name, address) rather than one row per player because the whole
 * point is to notice when ONE address has produced TWO names — a shared house
 * or a CGNAT pool — which is exactly the case where an automatic link would
 * link the wrong person and must refuse.
 */
export const playerIpSeen = pgTable(
  "player_ip_seen",
  {
    mcName: text("mc_name").notNull(),
    ip: text("ip").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mcName, t.ip] }), index("player_ip_seen_ip_idx").on(t.ip)],
);

/**
 * The fallback when an address cannot decide: a short code shown on the website
 * and typed in game as `!link <code>`.
 *
 * Not a nicety. A player whose browser reaches the site over IPv6 while the
 * game connects over IPv4 — normal on Thai consumer ISPs — will never match by
 * address, and the website gates posting on being linked. Without this path
 * those players simply could not speak. → ADR-0016
 */
export const linkCode = pgTable("link_code", {
  code: text("code").primaryKey(),
  discordId: text("discord_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * What has already been announced.
 *
 * Milestones are discovered by DIFFING files the Game Server writes, so a
 * restart, a re-scan, or a world reload would re-discover everything that ever
 * happened. This table is what makes "congratulations" a one-time event rather
 * than a function of how often the bot restarted.
 *
 * `kind` is the source of truth kind ("quest", "kill"), `key` the identifier
 * within it (a quest id, an entity id).
 */
export const playerMilestone = pgTable(
  "player_milestone",
  {
    mcName: text("mc_name").notNull(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    detail: text("detail"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mcName, t.kind, t.key] })],
);

/**
 * The curated answer to "which of these is worth interrupting people for".
 *
 * Dregora has 403 quests and the stats file counts every entity ever killed;
 * announcing all of it would be noise nobody reads. Policy, therefore seeded
 * as source in db/seed/ rather than typed into a table by hand — the same
 * reasoning that makes the Edit Tiers a seed file.
 */
export const notableMilestone = pgTable(
  "notable_milestone",
  {
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    /** What Discord is told, in Thai. The pack ships no server-side translations. */
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key] })],
);
