/**
 * Configuration, read once and validated at boot.
 *
 * Fails fast and loudly on anything missing. A bot that starts and then
 * refuses every command because a role id is empty is far worse than one that
 * never starts: the first looks like a permissions problem and sends someone
 * hunting through Discord, the second names the variable.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see deploy/.env.example`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  token: required("DISCORD_BOT_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: required("DISCORD_GUILD_ID"),
  /**
   * ADR-0004's authority. Required, not optional: without it authorizeAdmin
   * throws on every call, and the break-glass allowlist alone is not a
   * configuration anyone should run on.
   */
  adminRoleId: required("DISCORD_ADMIN_ROLE_ID"),

  rcon: {
    host: optional("RCON_HOST", "mc"),
    port: Number(optional("RCON_PORT", "25575")),
    password: required("RCON_PASSWORD"),
  },

  docker: {
    baseUrl: optional("DOCKER_PROXY_URL", "http://socket-proxy:2375"),
    container: optional("MC_CONTAINER_NAME", "tapestopnight-mc"),
  },

  slp: {
    host: optional("MC_SLP_HOST", "mc"),
    port: Number(optional("MC_SLP_PORT", "25565")),
  },

  packDir: optional("PACK_DIR", "/pack"),
  publicBaseUrl: optional("PUBLIC_BASE_URL", "https://tapestopnight.com"),

  /** Lead time before a restart actually happens. */
  restartCountdownSeconds: Number(optional("RESTART_COUNTDOWN_SECONDS", "30")),
} as const;

export type Env = typeof env;
