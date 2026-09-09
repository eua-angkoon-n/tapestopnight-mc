import {
  boolean,
  customType,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
