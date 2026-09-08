import { eq } from "drizzle-orm";

import { adminAllowlist, type Database } from "../db/index.ts";

/**
 * The single authority on "who is an admin" — ADR-0004.
 *
 * Requirements 2.1 (web admin login), 2.2 (public read-only) and 3.1 (bot admin
 * commands) are one authorisation question asked in two places. Answering them
 * separately guarantees a "the web says I'm an admin but the bot disagrees"
 * class of bug, so both surfaces call THIS function and nothing else.
 *
 * Authority is a role in the Discord guild. The web app learns the caller's
 * roles from the `guilds.members.read` OAuth scope; the bot already has them on
 * the interaction's member object. Either way the decision is made here.
 */

export interface AuthorizeInput {
  readonly discordId: string;
  /** Role IDs the caller holds in the guild, however the surface obtained them. */
  readonly roleIds: readonly string[];
  /** The role that grants admin. From DISCORD_ADMIN_ROLE_ID. */
  readonly adminRoleId: string;
}

export type AdminGrant =
  | { readonly isAdmin: true; readonly via: "guild-role" }
  | { readonly isAdmin: true; readonly via: "break-glass"; readonly note: string | null }
  | { readonly isAdmin: false };

/**
 * Decide admin status.
 *
 * The break-glass allowlist is consulted second and exists so a Discord API
 * outage or a mangled role cannot lock everyone out of their own control
 * plane. Routine administration must never touch that table — granting admin
 * means assigning the Discord role, which is the one path that governs both
 * the web UI and the bot.
 *
 * `via` is returned rather than a bare boolean so callers can log *how* access
 * was granted. A break-glass grant appearing in normal operation is a signal
 * that something is wrong with the role setup.
 */
export async function authorizeAdmin(
  db: Database,
  input: AuthorizeInput,
): Promise<AdminGrant> {
  if (!input.adminRoleId) {
    throw new Error("adminRoleId is empty — DISCORD_ADMIN_ROLE_ID is not configured");
  }

  if (input.roleIds.includes(input.adminRoleId)) {
    return { isAdmin: true, via: "guild-role" };
  }

  const rows = await db
    .select({ note: adminAllowlist.note })
    .from(adminAllowlist)
    .where(eq(adminAllowlist.discordId, input.discordId))
    .limit(1);

  const row = rows[0];
  if (row) return { isAdmin: true, via: "break-glass", note: row.note };

  return { isAdmin: false };
}
