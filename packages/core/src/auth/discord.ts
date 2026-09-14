/**
 * The Discord API calls the web app needs to answer ADR-0004's question.
 *
 * The bot does not use this: an interaction already carries the member's
 * roles. Only the web app has to go and ask, because an OAuth login gives it a
 * user token and nothing else.
 */

const API = "https://discord.com/api/v10";

export interface GuildMember {
  readonly userId: string;
  readonly roleIds: string[];
  readonly nickname: string | null;
  readonly avatarHash: string | null;
}

/**
 * Fields are assigned in the constructor body rather than declared as
 * parameter properties. Node runs these sources directly by stripping types,
 * and a parameter property is not merely a type annotation - it emits an
 * assignment - so strip-only mode refuses the whole file with
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. The web app never noticed because Next
 * compiles rather than strips, and the poller never imported this module. The
 * bot does, under plain Node.
 */
export class DiscordApiError extends Error {
  readonly status: number;
  /**
   * How long Discord asked us to wait, in milliseconds, or null if it did not
   * say. Only ever set on a 429.
   *
   * Carried on the error rather than handled here because the retry decision
   * is not this function's to make: it has no idea whether the caller is a
   * page render that should give up or a job that can sleep.
   */
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "DiscordApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * `Retry-After` in milliseconds.
 *
 * Discord sends it in SECONDS on this endpoint, and fractionally — "0.75" is a
 * normal value. parseFloat, not parseInt, or every sub-second wait rounds to
 * zero and the caller retries immediately into the same limit.
 */
function retryAfterMsFrom(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number.parseFloat(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

/**
 * Read the caller's membership of one guild, using their own OAuth token.
 *
 * Requires the `guilds.members.read` scope. A 404 means the user is simply not
 * in the guild — which is a legitimate answer ("not an admin"), not an error,
 * so it is returned as null rather than thrown.
 */
export async function fetchGuildMember(
  accessToken: string,
  guildId: string,
): Promise<GuildMember | null> {
  const res = await fetch(`${API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new DiscordApiError(
      `GET /users/@me/guilds/${guildId}/member -> ${res.status}`,
      res.status,
      res.status === 429 ? retryAfterMsFrom(res) : null,
    );
  }

  const body = (await res.json()) as {
    user?: { id: string; avatar: string | null };
    roles: string[];
    nick: string | null;
  };

  return {
    userId: body.user?.id ?? "",
    roleIds: body.roles ?? [],
    nickname: body.nick ?? null,
    avatarHash: body.user?.avatar ?? null,
  };
}
