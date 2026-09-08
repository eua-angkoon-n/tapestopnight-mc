import { status, type JavaStatusResponse } from "minecraft-server-util";

/**
 * Read the Game Server's status over Server List Ping.
 *
 * SLP is the same handshake the Minecraft client performs to render a server in
 * the multiplayer list. It returns the player counts, a sample of names, the
 * MOTD and the icon, needs no RCON password, and is far cheaper than RCON.
 * RCON is reserved for actually issuing commands.
 */

// No protocol version to set: JavaStatusOptions exposes only `timeout` and
// `enableSRV`, and the library picks the handshake version itself. A status
// ping is answered regardless of the number sent, and the reply carries the
// server's real protocol in `version.protocol` — which is what we read.

export interface GameServerStatus {
  readonly online: true;
  readonly playersOnline: number;
  readonly playersMax: number;
  readonly sample: string[];
  readonly motd: string;
  /** Base64 data URI, or null when server-icon.png is absent. */
  readonly favicon: string | null;
  readonly versionName: string;
  readonly protocol: number;
  readonly latencyMs: number;
}

export interface GameServerOffline {
  readonly online: false;
  /** Kept for the log, never shown to a visitor as-is. */
  readonly error: string;
}

export type StatusResult = GameServerStatus | GameServerOffline;

export interface StatusOptions {
  readonly host: string;
  readonly port?: number;
  /**
   * Generous on purpose. A ping timing out does NOT mean the server is down:
   * `max-tick-time=-1` is mandatory for this pack because OTG structure
   * generation legitimately blocks the main thread for minutes, and that looks
   * exactly like a hang. The verdict on "offline" is the container state plus
   * a TCP probe, never a timeout here.
   */
  readonly timeoutMs?: number;
}

export async function readStatus(opts: StatusOptions): Promise<StatusResult> {
  try {
    const res: JavaStatusResponse = await status(opts.host, opts.port ?? 25565, {
      timeout: opts.timeoutMs ?? 10_000,
      enableSRV: false, // we address the container directly on the compose network
    });
    return {
      online: true,
      playersOnline: res.players.online ?? 0,
      playersMax: res.players.max ?? 0,
      sample: (res.players.sample ?? []).map((p: { name: string }) => p.name),
      motd: res.motd.clean,
      favicon: res.favicon ?? null,
      versionName: res.version.name ?? "unknown",
      protocol: res.version.protocol,
      // The library measures this itself; more accurate than wrapping the call.
      latencyMs: res.roundTripLatency,
    };
  } catch (err) {
    return { online: false, error: err instanceof Error ? err.message : String(err) };
  }
}
