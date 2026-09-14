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

/*
  What to do when the role check FAILS, which is a different question from how
  often to repeat one that succeeded.

  This used to set rolesCheckedAt = 0, meaning "check again on the very next
  request". Against a 429 that is the worst possible response: the endpoint is
  rate limited precisely because it has been called too often, and every page
  load then calls it again, takes another 429, and rearms itself. Once an admin
  crossed the limit they could not get back under it while they kept using the
  site — observed as an authorisation check that failed "quite often" and
  seemed to recover at random.

  So a failure now schedules its own next attempt. Discord's own Retry-After is
  used when it sends one; otherwise the wait doubles from 30s and is capped at
  the TTL, because waiting longer than the success interval would just make a
  successful check stale anyway.
*/
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = ROLE_TTL_MS;

function backoffMs(failures: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, RETRY_MAX_MS);
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
}

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
    /**
     * Set when the reason the check failed was Discord rate limiting us, not
     * Discord being down.
     *
     * It earns its own flag because the two want opposite advice. For an
     * outage, signing in again is worth trying. For a rate limit it is the
     * worst thing the person can do: a fresh sign-in forces an immediate
     * check, which is another request against the limit that is already
     * refusing us.
     */
    adminCheckRateLimited: boolean;
    /** Seconds until the next check is allowed, so the page can say so. */
    adminCheckRetryInSeconds: number;
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

      const now = Date.now();
      const notBefore = (token.roleRetryNotBefore as number | undefined) ?? 0;

      // Two separate gates. The TTL says a good answer has gone stale; the
      // backoff says a bad answer is not worth re-asking yet. Both must allow
      // it, or a failing check re-arms itself every request.
      if (accessToken && discordId && now - checkedAt > ROLE_TTL_MS && now >= notBefore) {
        try {
          const member = await fetchGuildMember(accessToken, GUILD_ID);
          const decision = await decideAdmin(discordId, member?.roleIds ?? []);
          token.isAdmin = decision.isAdmin;
          token.adminVia = decision.via;
          token.adminCheckFailed = false;
          token.rolesCheckedAt = Date.now();
          token.roleFailures = 0;
          token.roleRetryNotBefore = 0;
          token.adminCheckRateLimited = false;
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
          const apiErr = err instanceof DiscordApiError ? err : null;
          const failures = ((token.roleFailures as number | undefined) ?? 0) + 1;
          const wait = backoffMs(failures, apiErr?.retryAfterMs ?? null);

          const status = apiErr ? ` status=${apiErr.status}` : "";
          const told = apiErr?.retryAfterMs != null ? " (Discord's Retry-After)" : "";
          console.error(
            `[auth] role check FAILED for ${discordId}${status}: ` +
              `${err instanceof Error ? err.message : String(err)} — ` +
              `denying admin, attempt ${failures}, next try in ` +
              `${Math.round(wait / 1000)}s${told}`,
          );
          token.isAdmin = false;
          token.adminVia = null;
          token.adminCheckFailed = true;
          token.rolesCheckedAt = 0;
          token.roleFailures = failures;
          token.roleRetryNotBefore = Date.now() + wait;
          token.adminCheckRateLimited = apiErr?.status === 429;
        }
      }

      return token;
    },

    session({ session, token }) {
      session.discordId = (token.discordId as string | undefined) ?? "";
      session.isAdmin = (token.isAdmin as boolean | undefined) ?? false;
      session.adminVia = (token.adminVia as Session["adminVia"]) ?? null;
      session.adminCheckFailed = (token.adminCheckFailed as boolean | undefined) ?? false;
      session.adminCheckRateLimited =
        (token.adminCheckRateLimited as boolean | undefined) ?? false;
      const notBefore = (token.roleRetryNotBefore as number | undefined) ?? 0;
      session.adminCheckRetryInSeconds = Math.max(0, Math.ceil((notBefore - Date.now()) / 1000));
      return session;
    },
  },
});
