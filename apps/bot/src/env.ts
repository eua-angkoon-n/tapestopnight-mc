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

  /**
   * Project Zomboid's RCON.
   *
   * 27015, not Minecraft's 25575. The host defaults to the PZ container's name
   * on the shared `pz-ops` network — the two systems live in separate compose
   * projects, so without that network this bot cannot reach the server at all
   * and RCON's loopback publish on the Host is not reachable from a container.
   *
   * This is the ONLY channel to the running server. PZ has no Server List Ping,
   * so there is no cheap probe to read instead and no Status Poller writing a
   * cache — `/server status` and `/players list` both come through here.
   */
  rcon: {
    host: optional("RCON_HOST", "tapestopnight-pz"),
    port: Number(optional("RCON_PORT", "27015")),
    password: required("RCON_PASSWORD"),
  },

  docker: {
    baseUrl: optional("DOCKER_PROXY_URL", "http://socket-proxy:2375"),
    container: optional("PZ_CONTAINER_NAME", "tapestopnight-pz"),
  },

  /**
   * How players reach the server.
   *
   * A bare IP and port, not a domain: PZ speaks UDP, so it cannot sit behind
   * Caddy or the Cloudflare proxy, and the server is unlisted (`PUBLIC=false`)
   * so nobody finds it in the in-game browser either. Everyone types this in by
   * hand, which is exactly why /info ip exists.
   */
  serverAddress: optional("PZ_SERVER_ADDRESS", "217.216.111.122"),
  serverPort: optional("PZ_SERVER_PORT", "16261"),

  publicBaseUrl: optional("PUBLIC_BASE_URL", "https://tapestopnight.com"),

  /** Lead time before a restart actually happens. */
  restartCountdownSeconds: Number(optional("RESTART_COUNTDOWN_SECONDS", "30")),

  /**
   * How long Docker waits for the server to save on the way down.
   *
   * 180 s matches `stop_grace_period: 3m` in the Zomboid compose file, and that
   * number is load-bearing: the entrypoint traps SIGTERM, writes `quit` into
   * the server console FIFO — which is what saves the world — and waits. The
   * first clean shutdown measured took 15 seconds, over Docker's 10-second
   * default, which is why the grace period exists at all. Never shorten this
   * below the compose value.
   */
  stopTimeoutSeconds: Number(optional("PZ_STOP_TIMEOUT_SECONDS", "180")),
} as const;

export type Env = typeof env;
