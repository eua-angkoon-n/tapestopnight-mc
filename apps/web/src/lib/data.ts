import { createDb, serverInfo, serverStatusCache } from "@tapestopnight/core/db";

/**
 * Server-side reads for the public pages.
 *
 * These read the Status Poller's CACHE ROW. They never probe the Game Server.
 * If each request probed directly, fifty concurrent visitors would mean fifty
 * probes; the poller exists so the Game Server sees constant load regardless
 * of how many people are looking.
 */

export interface PublicStatus {
  readonly online: boolean;
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  readonly sample: readonly string[];
  readonly motd: string | null;
  readonly lastSeenOnline: Date | null;
  /** How stale the cache is. Rendered so a frozen poller is visible, not hidden. */
  readonly probedAt: Date | null;
}

export interface PublicServerInfo {
  readonly modpackName: string;
  readonly modpackVersion: string;
  readonly minecraftVersion: string;
  readonly forgeVersion: string;
  readonly serverAddress: string;
  readonly downloadUrl: string | null;
  /** Where the hero's Discord button goes. Null renders an honest note, not a dead button. */
  readonly discordUrl: string | null;
  /** The wiki the second section embeds, and links to as a fallback. */
  readonly wikiUrl: string | null;
  readonly rulesMarkdown: string | null;
  /**
   * Digest of the uploaded Server Icon, or null if there is none.
   *
   * Deliberately the digest and not the image. The bytes are served by
   * /api/icon; pulling a megabyte of bytea into every public page render just
   * to decide whether to show an <img> would be absurd. It doubles as the
   * cache-buster on that URL.
   */
  readonly iconSha: string | null;
}

const OFFLINE_FALLBACK: PublicStatus = {
  online: false,
  playersOnline: null,
  playersMax: null,
  sample: [],
  motd: null,
  lastSeenOnline: null,
  probedAt: null,
};

export async function loadPublicData(): Promise<{
  status: PublicStatus;
  info: PublicServerInfo | null;
}> {
  const { db, sql } = createDb();
  try {
    const [statusRows, infoRows] = await Promise.all([
      db.select().from(serverStatusCache).limit(1),
      // Columns named explicitly: `select()` would drag both icon blobs out of
      // Postgres on every page load, and neither is rendered from here.
      db
        .select({
          modpackName: serverInfo.modpackName,
          modpackVersion: serverInfo.modpackVersion,
          minecraftVersion: serverInfo.minecraftVersion,
          forgeVersion: serverInfo.forgeVersion,
          serverAddress: serverInfo.serverAddress,
          downloadUrl: serverInfo.downloadUrl,
          discordUrl: serverInfo.discordUrl,
          wikiUrl: serverInfo.wikiUrl,
          rulesMarkdown: serverInfo.rulesMarkdown,
          iconSha: serverInfo.iconSourceSha256,
        })
        .from(serverInfo)
        .limit(1),
    ]);

    const s = statusRows[0];
    const i = infoRows[0];

    return {
      status: s
        ? {
            online: s.online,
            playersOnline: s.playersOnline,
            playersMax: s.playersMax,
            sample: s.sample ?? [],
            motd: s.motd,
            lastSeenOnline: s.lastSeenOnline,
            probedAt: s.probedAt,
          }
        : // No row yet means the poller has never run. Showing "offline" is the
          // honest answer: we genuinely do not know that it is up.
          OFFLINE_FALLBACK,
      info: i
        ? {
            modpackName: i.modpackName,
            modpackVersion: i.modpackVersion,
            minecraftVersion: i.minecraftVersion,
            forgeVersion: i.forgeVersion,
            serverAddress: i.serverAddress,
            downloadUrl: i.downloadUrl,
            discordUrl: i.discordUrl,
            wikiUrl: i.wikiUrl,
            rulesMarkdown: i.rulesMarkdown,
            iconSha: i.iconSha,
          }
        : null,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Is the cached status old enough to distrust?
 *
 * The poller writes every 15 s. Past a minute something is wrong with the
 * poller itself, and saying so beats presenting stale numbers as current.
 */
export function isStale(probedAt: Date | null, thresholdMs = 60_000): boolean {
  if (!probedAt) return true;
  return Date.now() - probedAt.getTime() > thresholdMs;
}

/** "2 ชั่วโมงที่แล้ว" — Thai relative time, for the offline state. */
export function thaiAgo(then: Date | null): string | null {
  if (!then) return null;
  const secs = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (secs < 60) return "ไม่กี่วินาทีที่แล้ว";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}
