/**
 * Deciding which Minecraft player a Discord account is.
 *
 * In core, not in the web app, for ADR-0006's reason: the website links by
 * address and the bot links by code, and two implementations of "who is this
 * person" would drift into the bug where the site says you are linked and the
 * bot says you are not.
 *
 * → ADR-0016 records what address matching can and cannot do.
 */
import { and, eq, gt, sql as raw } from "drizzle-orm";

import { linkCode, playerIpSeen, playerLink, type Database } from "../db/index.ts";

/** How long an address stays evidence. Long enough for a weekly player. */
const IP_TTL_DAYS = 14;

/** Long enough not to be guessed in the minutes it lives, short enough to type. */
const CODE_TTL_MINUTES = 15;

/** No I, O, 0, 1: this gets read off a screen and typed into a game chat box. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export type AutoLinkResult =
  | { readonly status: "linked"; readonly mcName: string }
  | { readonly status: "already"; readonly mcName: string }
  /** The address has produced more than one player. Linking either would be a guess. */
  | { readonly status: "ambiguous" }
  /** That player is already someone else's. */
  | { readonly status: "taken"; readonly mcName: string }
  | { readonly status: "no-match" };

/** The Minecraft name behind a Discord account, or null if it is not linked. */
export async function linkedNameFor(db: Database, discordId: string): Promise<string | null> {
  const [row] = await db
    .select({ mcName: playerLink.mcName })
    .from(playerLink)
    .where(eq(playerLink.discordId, discordId))
    .limit(1);
  return row?.mcName ?? null;
}

/**
 * Link by matching the browser's address against one seen logging in.
 *
 * **Refuses when the address is shared.** Two names behind one address is the
 * normal case for a household or a CGNAT pool, and picking one of them would
 * hand somebody another player's identity. The caller falls back to a code,
 * which is why that path is not optional.
 */
export async function autoLinkByIp(
  db: Database,
  params: { discordId: string; ip: string },
): Promise<AutoLinkResult> {
  const existing = await linkedNameFor(db, params.discordId);
  if (existing) return { status: "already", mcName: existing };

  const since = new Date(Date.now() - IP_TTL_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db
    .selectDistinct({ mcName: playerIpSeen.mcName })
    .from(playerIpSeen)
    .where(and(eq(playerIpSeen.ip, params.ip), gt(playerIpSeen.lastSeenAt, since)));

  const only = candidates[0];
  if (!only) return { status: "no-match" };
  if (candidates.length > 1) return { status: "ambiguous" };

  return claim(db, { mcName: only.mcName, discordId: params.discordId, via: "ip" });
}

/**
 * Write the link, unless that player already belongs to someone.
 *
 * Both directions are unique in the schema, so this is the one place that has
 * to reconcile "the row I want already exists" with "it exists for someone
 * else" — a distinction the caller must be able to explain to a person.
 */
async function claim(
  db: Database,
  params: { mcName: string; discordId: string; via: "ip" | "code" },
): Promise<AutoLinkResult> {
  const [owner] = await db
    .select({ discordId: playerLink.discordId })
    .from(playerLink)
    .where(eq(playerLink.mcName, params.mcName))
    .limit(1);

  if (owner) {
    return owner.discordId === params.discordId
      ? { status: "already", mcName: params.mcName }
      : { status: "taken", mcName: params.mcName };
  }

  await db.insert(playerLink).values({
    mcName: params.mcName,
    discordId: params.discordId,
    linkedVia: params.via,
  });
  return { status: "linked", mcName: params.mcName };
}

/**
 * Hand out a code for someone to type in game.
 *
 * One live code per Discord account: asking again replaces the previous one
 * rather than leaving a trail of codes that all still work.
 */
export async function issueLinkCode(db: Database, discordId: string): Promise<string> {
  await db.delete(linkCode).where(eq(linkCode.discordId, discordId));

  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

  await db.insert(linkCode).values({
    code,
    discordId,
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
  });
  return code;
}

/**
 * Spend a code typed in game as `!link <code>`.
 *
 * The code is consumed whether or not the link succeeds. It has already been
 * spoken aloud in a public chat channel by the time this runs — leaving it
 * live so it can be retried would also leave it live for whoever read it.
 */
export async function redeemLinkCode(
  db: Database,
  params: { code: string; mcName: string },
): Promise<AutoLinkResult | { readonly status: "bad-code" }> {
  const [row] = await db
    .delete(linkCode)
    .where(and(eq(linkCode.code, params.code), gt(linkCode.expiresAt, new Date())))
    .returning({ discordId: linkCode.discordId });

  if (!row) return { status: "bad-code" };
  return claim(db, { mcName: params.mcName, discordId: row.discordId, via: "code" });
}

/** Remember where a player logged in from. Called for every login line. */
export async function recordLoginIp(
  db: Database,
  params: { mcName: string; ip: string },
): Promise<void> {
  await db
    .insert(playerIpSeen)
    .values({ mcName: params.mcName, ip: params.ip })
    .onConflictDoUpdate({
      target: [playerIpSeen.mcName, playerIpSeen.ip],
      set: { lastSeenAt: raw`now()` },
    });
}

/** Housekeeping for both short-lived tables. Cheap enough to run on every scan. */
export async function expireStaleLinkState(db: Database): Promise<void> {
  await db.delete(linkCode).where(raw`${linkCode.expiresAt} < now()`);
}
