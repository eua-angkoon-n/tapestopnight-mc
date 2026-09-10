import { RCON } from "minecraft-server-util";

/**
 * Issue commands to the Game Server.
 *
 * RCON binds to the internal Docker network only; 25575 is never published to
 * the Host. It is used for commands — never for status, which is what Server
 * List Ping is for, and never to decide whether the server is up.
 */

export interface RconOptions {
  readonly host: string;
  readonly port?: number;
  readonly password: string;
  readonly timeoutMs?: number;
}

/** Run one or more commands on a single connection, then close it. */
export async function withRcon<T>(
  opts: RconOptions,
  fn: (run: (command: string) => Promise<string>) => Promise<T>,
): Promise<T> {
  const client = new RCON();
  await client.connect(opts.host, opts.port ?? 25575, { timeout: opts.timeoutMs ?? 10_000 });
  try {
    await client.login(opts.password);
    return await fn((command) => client.execute(command).then(String));
  } finally {
    // close() is synchronous and returns void in this library.
    try {
      client.close();
    } catch {
      /* the command already ran; a failed close must not mask its result */
    }
  }
}

/**
 * The authoritative player list.
 *
 * Server List Ping returns only a *sample* of names — typically capped around
 * twelve and shuffled — so it cannot answer "who is on right now" once the
 * server is busy. `/list` can.
 */
export async function listPlayers(opts: RconOptions): Promise<string[]> {
  return withRcon(opts, async (run) => {
    const out = await run("list");
    // "There are 3/20 players online: alice, bob, carol"
    const after = out.split(":").slice(1).join(":").trim();
    return after ? after.split(",").map((n) => n.trim()).filter(Boolean) : [];
  });
}

/** Announce to everyone in-game. Used before a restart or an Apply. */
export async function say(opts: RconOptions, message: string): Promise<void> {
  await withRcon(opts, (run) => run(`say ${message}`));
}

/**
 * Ask the server to save and stop.
 *
 * Preferred over killing the container: a large OTG world takes minutes to
 * write, and cutting that short is how worlds corrupt.
 */
export async function requestStop(opts: RconOptions): Promise<void> {
  await withRcon(opts, (run) => run("stop"));
}

/**
 * Put one bridged message in front of everyone in the game.
 *
 * `tellraw`, not `say`, for two measured reasons. `say` from an RCON
 * connection renders as `[Rcon] …` in front of players, which tells them
 * nothing true about who spoke. And `say` is echoed back into the server log,
 * where the bridge's own log reader would find it — `tellraw` prints nothing
 * to the log at all, so a message cannot make a round trip.
 *
 * The command itself is built by `tellrawCommand` in core/bridge, which is
 * where the escaping lives. Do not assemble one here.
 */
export async function broadcast(opts: RconOptions, command: string): Promise<void> {
  await withRcon(opts, (run) => run(command));
}
