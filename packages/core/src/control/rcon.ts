import { connect, type Socket } from "node:net";

/**
 * Issue commands to the Project Zomboid server.
 *
 * RCON binds to the Host's loopback and to the shared `pz-ops` docker network;
 * 27015 is never published to the world. It is used for commands AND for the
 * player list, because unlike Minecraft there is no Server List Ping to ask
 * instead — PZ answers a Steam A2S query on the UDP game port and nothing that
 * would serve a player list over TCP.
 *
 * ── Why this is hand-written ─────────────────────────────────────────
 *
 * `minecraft-server-util`'s RCON client, which drove the Minecraft server,
 * CANNOT log in to Project Zomboid. Measured against the live server on
 * 2026-10-15:
 *
 *     connect+login: FAILED — Expected server to send packet type 2, received 0
 *
 * PZ answers SERVERDATA_AUTH with an empty type-0 packet and sends the type-2
 * auth result after it. That is within the Source RCON protocol; the strict
 * client is the one in the wrong. Tolerating the leading packet is a few lines,
 * and the alternative — a second RCON dependency beside the one already
 * installed — costs more resident memory than the whole implementation
 * (ADR-0012), the same reasoning that keeps `control/docker.ts` free of
 * dockerode.
 *
 * Verified against the live server, all three commands this module ships:
 *
 *     players                      -> "Players connected (0): \n"
 *     servermsg "rcon smoke test"  -> "Message sent."
 *     save                         -> "World saved"
 *
 * ── Wire format ──────────────────────────────────────────────────────
 *
 * All integers little-endian:
 *
 *     int32 length   of everything after this field
 *     int32 id       echoed back, so replies can be matched
 *     int32 type     3 auth · 2 exec and auth-ok · 0 response
 *     bytes body     NUL-terminated
 *     byte  0        second terminator
 */

const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
/** Both "your password was accepted" and "execute this" share the number. */
const TYPE_AUTH_OK = 2;
const TYPE_RESPONSE = 0;

export interface RconOptions {
  readonly host: string;
  readonly port?: number;
  readonly password: string;
  readonly timeoutMs?: number;
}

interface Packet {
  readonly id: number;
  readonly type: number;
  readonly body: string;
}

function encode(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, "utf8");
  const buf = Buffer.alloc(14 + payload.length);
  buf.writeInt32LE(10 + payload.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  payload.copy(buf, 12);
  // The two trailing NULs are already zero from Buffer.alloc.
  return buf;
}

/** Pull every complete packet out of the accumulator, leaving any partial tail. */
function drain(state: { buf: Buffer }): Packet[] {
  const out: Packet[] = [];
  for (;;) {
    if (state.buf.length < 4) break;
    const len = state.buf.readInt32LE(0);
    if (state.buf.length < 4 + len) break;
    out.push({
      id: state.buf.readInt32LE(4),
      type: state.buf.readInt32LE(8),
      body: state.buf.subarray(12, 4 + len - 2).toString("utf8"),
    });
    state.buf = state.buf.subarray(4 + len);
  }
  return out;
}

interface Waiter {
  packets: Packet[];
  reject: (err: Error) => void;
  bump: () => void;
}

/** Run one or more commands on a single connection, then close it. */
export async function withRcon<T>(
  opts: RconOptions,
  fn: (run: (command: string) => Promise<string>) => Promise<T>,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const socket: Socket = connect({ host: opts.host, port: opts.port ?? 27015 });
  const state = { buf: Buffer.alloc(0) };
  const waiters: Waiter[] = [];

  socket.on("data", (chunk: Buffer) => {
    state.buf = Buffer.concat([state.buf, chunk]);
    const packets = drain(state);
    const waiter = waiters[0];
    if (!waiter) return;
    waiter.packets.push(...packets);
    waiter.bump();
  });

  const failCurrent = (err: Error) => waiters[0]?.reject(err);
  socket.on("error", failCurrent);
  socket.on("close", () => failCurrent(new Error("RCON connection closed")));

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
    socket.setTimeout(timeoutMs, () => reject(new Error("RCON connect timed out")));
  });
  socket.setTimeout(0);

  /*
    Collect packets until the server goes quiet.

    Source RCON has no field spanning a multi-packet response, so "finished" has
    to be inferred: `settleMs` of silence once at least one packet has arrived.
    `done` lets the auth step stop the moment it has its answer rather than
    always paying the settle delay.
  */
  function exchange(
    buffer: Buffer,
    { settleMs = 250, done }: { settleMs?: number; done?: (p: Packet[]) => boolean } = {},
  ): Promise<Packet[]> {
    return new Promise<Packet[]>((resolve, reject) => {
      let settle: NodeJS.Timeout | null = null;

      const finish = (err: Error | null) => {
        clearTimeout(total);
        if (settle) clearTimeout(settle);
        waiters.shift();
        if (err) reject(err);
        else resolve(waiter.packets);
      };

      const total = setTimeout(
        () => finish(waiter.packets.length ? null : new Error("RCON timed out")),
        timeoutMs,
      );

      const waiter: Waiter = {
        packets: [],
        reject: (err) => finish(err),
        bump: () => {
          if (done && done(waiter.packets)) return finish(null);
          if (settle) clearTimeout(settle);
          settle = setTimeout(() => finish(null), settleMs);
        },
      };

      waiters.push(waiter);
      socket.write(buffer);
    });
  }

  try {
    // Stop on the type-2 result rather than on the first thing that arrives:
    // the empty type-0 packet PZ sends first is exactly what broke the previous
    // client.
    const authPackets = await exchange(encode(1, TYPE_AUTH, opts.password), {
      done: (packets) => packets.some((p) => p.type === TYPE_AUTH_OK),
    });
    const result = authPackets.find((p) => p.type === TYPE_AUTH_OK);
    if (!result) throw new Error("RCON: no auth response");
    // The protocol's way of saying "wrong password" is an id of -1.
    if (result.id === -1) throw new Error("RCON: authentication rejected");

    return await fn(async (command: string) => {
      const packets = await exchange(encode(2, TYPE_EXEC, command));
      return packets
        .filter((p) => p.type === TYPE_RESPONSE)
        .map((p) => p.body)
        .join("");
    });
  } finally {
    socket.destroy();
  }
}

/**
 * Who is actually on right now.
 *
 * The authoritative answer and the only one available — which is why the Status
 * Poller that served the Minecraft server has no counterpart here.
 *
 * The server replies with a count line followed by one name per line, each
 * prefixed with "-":
 *
 *     Players connected (2):
 *     -alice
 *     -bob
 *
 * and with nobody on, the header alone. Parsed by taking the lines after the
 * first rather than by trusting the number in the header, so a disagreement
 * between the two cannot produce phantom names.
 */
export async function listPlayers(opts: RconOptions): Promise<string[]> {
  return withRcon(opts, async (run) => {
    const out = await run("players");
    return out
      .split("\n")
      .slice(1)
      .map((line) => line.trim().replace(/^-/, "").trim())
      .filter(Boolean);
  });
}

/**
 * Announce to everyone in-game. Used before a restart or a stop.
 *
 * `servermsg`, which is PZ's broadcast. Quotes are stripped rather than escaped
 * because the command takes one quoted argument and PZ offers no escape for an
 * embedded quote — a message that loses its punctuation is better than one that
 * truncates halfway through a countdown.
 */
export async function say(opts: RconOptions, message: string): Promise<void> {
  const safe = message.replace(/"/g, "");
  await withRcon(opts, (run) => run(`servermsg "${safe}"`));
}

/**
 * Flush the world to disk.
 *
 * Belt and braces before a stop. `stop_grace_period: 3m` and the entrypoint's
 * SIGTERM handler already save on the way down; this shrinks the window in
 * which a crash could lose progress, and costs a few hundred milliseconds.
 */
export async function requestSave(opts: RconOptions): Promise<void> {
  await withRcon(opts, (run) => run("save"));
}

/**
 * Ask the server to save and stop.
 *
 * Rarely the right call from here: `docker compose stop` goes through the
 * entrypoint, which writes `quit` into the server console FIFO and waits for
 * the save, leaving the container's state consistent with what Docker believes.
 * Kept for the case where the container must outlive a server shutdown.
 */
export async function requestStop(opts: RconOptions): Promise<void> {
  await withRcon(opts, (run) => run("quit"));
}
