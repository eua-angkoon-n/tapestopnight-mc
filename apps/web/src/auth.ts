import NextAuth from "next-auth";
import type { Session } from "next-auth";
import Discord from "next-auth/providers/discord";

import { createDb } from "@tapestopnight/core/db";
import { DiscordApiError, authorizeAdmin, fetchGuildMember } from "@tapestopnight/core/auth";

/**
 * Discord login, and the admin decision — ADR-0004.
 *
 * `guilds.members.read` is the scope that matters: it is what lets us ask
 * Discord which roles this person holds in the guild. `identify` gives us their
 * id and name.
 *
 * ── The revocation window, stated plainly ─────────────────────────────────
 * Roles live on Discord, but a session lives in a cookie. If an admin's role is
 * removed, their existing session does not become powerless the instant it
 * happens — it stops working when we next re-ask Discord. Pretending otherwise
 * would be the dangerous option, so the window is explicit and short:
 *
 *   ROLE_TTL_MS   how stale a cached role set may be          5 minutes
 *   session.maxAge  how long a session survives at all         12 hours
 *
 * And separately from either: every mutating admin action re-checks
 * authorisation server-side before doing anything (see requireAdmin). Page
 * render decides what to SHOW; the action decides what to DO. Only the second
 * one is a security boundary.
 */

const ROLE_TTL_MS = 5 * 60 * 1000;

const GUILD_ID = process.env.DISCORD_GUILD_ID ?? "";
const ADMIN_ROLE_ID = process.env.DISCORD_ADMIN_ROLE_ID ?? "";

declare module "next-auth" {
  interface Session {
    discordId: string;
    isAdmin: boolean;
    adminVia: "guild-role" | "break-glass" | null;
    /**
     * Set when Discord could not be asked, as distinct from being asked and
     * told no. Both deny access — the difference is what we tell the person,
     * because "you are not an admin" sends someone to re-check a role that
     * was never the problem.
     */
    adminCheckFailed: boolean;
  }
}

async function decideAdmin(
  discordId: string,
  roleIds: string[],
): Promise<{ isAdmin: boolean; via: "guild-role" | "break-glass" | null }> {
  const { db, sql } = createDb();
  try {
    const grant = await authorizeAdmin(db, { discordId, roleIds, adminRoleId: ADMIN_ROLE_ID });
    return grant.isAdmin ? { isAdmin: true, via: grant.via } : { isAdmin: false, via: null };
  } finally {
    await sql.end();
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      authorization:
        "https://discord.com/oauth2/authorize?scope=identify+guilds.members.read",
    }),
  ],

  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },

  callbacks: {
    async jwt({ token, account, profile }) {
      // Fresh sign-in: keep the Discord access token so roles can be re-read
      // later without forcing the user through the OAuth dance again.
      if (account?.access_token) {
        token.discordAccessToken = account.access_token;
        token.discordId = (profile as { id?: string } | undefined)?.id ?? token.sub ?? "";
        token.rolesCheckedAt = 0; // force a check on this very first pass
      }

      const checkedAt = (token.rolesCheckedAt as number | undefined) ?? 0;
      const accessToken = token.discordAccessToken as string | undefined;
      const discordId = (token.discordId as string | undefined) ?? "";

      if (accessToken && discordId && Date.now() - checkedAt > ROLE_TTL_MS) {
        try {
          const member = await fetchGuildMember(accessToken, GUILD_ID);
          const decision = await decideAdmin(discordId, member?.roleIds ?? []);
          token.isAdmin = decision.isAdmin;
          token.adminVia = decision.via;
          token.adminCheckFailed = false;
          token.rolesCheckedAt = Date.now();
          if (!member) {
            // A 404 from Discord means "not in that guild", which is a real
            // answer rather than an error — and a confusing one if the guild
            // id is wrong, so say which guild was asked about.
            console.warn(`[auth] ${discordId} is not a member of guild ${GUILD_ID}`);
          }
        } catch (err) {
          /*
            Discord is unreachable. Do NOT extend the previous verdict on the
            strength of a failed check — drop to non-admin and let the next
            tick recover. The break-glass allowlist in Postgres is what covers
            a genuine Discord outage, and decideAdmin consults it.

            LOG IT. This catch used to be silent, and a silent catch here
            produces the single most confusing symptom this app can have: an
            admin who holds the right role is told they are not an admin, with
            nothing anywhere saying why. Diagnosing that cost a round trip
            through the Discord API to prove the role was fine all along.
          */
          const status = err instanceof DiscordApiError ? ` status=${err.status}` : "";
          console.error(
            `[auth] role check FAILED for ${discordId}${status}: ` +
              `${err instanceof Error ? err.message : String(err)} — ` +
              `denying admin until the next check succeeds`,
          );
          token.isAdmin = false;
          token.adminVia = null;
          token.adminCheckFailed = true;
          token.rolesCheckedAt = 0;
        }
      }

      return token;
    },

    session({ session, token }) {
      session.discordId = (token.discordId as string | undefined) ?? "";
      session.isAdmin = (token.isAdmin as boolean | undefined) ?? false;
      session.adminVia = (token.adminVia as Session["adminVia"]) ?? null;
      session.adminCheckFailed = (token.adminCheckFailed as boolean | undefined) ?? false;
      return session;
    },
  },
});
