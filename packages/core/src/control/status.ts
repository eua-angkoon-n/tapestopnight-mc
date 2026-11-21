import { connect } from "node:net";

/**
 * Read the Game Server's status over Server List Ping.
 *
 * SLP is the same handshake the Minecraft client performs to render a server in
 * the multiplayer list. It returns the player counts, a sample of names, the
 * MOTD and the icon, needs no RCON password, and is far cheaper than RCON.
 * RCON is reserved for actually issuing commands.
 *
 * ── Why this is written out by hand ────────────────────────────────────────
 *
 * It used to be `status()` from minecraft-server-util. Against Prominence II
 * that call failed every single time — 3,978 of 3,978 probes between the
 * cutover on 2026-11-20 and 2026-11-22, each ending "Socket closed unexpectedly
 * while waiting for data" some 200 ms in — so the site showed a server that was
 * up but had no player count. The same handshake built by hand, from the same
 * network, was answered in 78 ms; so was itzg's `mc-monitor`. Which of the
 * library's habits the pack objects to was not isolated (the `connectivity`
 * mod rewrites packet decoding and is the first suspect). It did not need to
 * be: the exchange is two packets out and one back, and owning thirty lines of
 * it is cheaper than depending on a library's exact byte pattern.
 *
 * What is sent: a handshake (next state 1) and a status request, in one write.
 * What is NOT sent: the ping packet that follows in a real client. It exists
 * to measure latency, which the time to the status reply already tells us.
 */

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
   * `max-tick-time=-1` is mandatory for this pack because chunk
   * generation legitimately blocks the main thread for minutes, and that looks
   * exactly like a hang. The verdict on "offline" is the container state plus
   * a TCP probe, never a timeout here.
   */
  readonly timeoutMs?: number;
}

/**
 * The protocol number in the handshake. A status request is answered whatever
 * number is sent — measured here with both 47 and 763 — and the reply carries
 * the server's real one, which is what we report. 763 is Minecraft 1.20.1.
 */
const HANDSHAKE_PROTOCOL = 763;

/** A status reply with a 64×64 icon is ~10 kB. Anything near this is not one. */
const MAX_REPLY_BYTES = 1024 * 1024;

function varInt(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value >>> 0;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest !== 0);
  return Buffer.from(bytes);
}

/** Returns [value, bytes consumed], or null when the buffer ends mid-number. */
function readVarInt(buf: Buffer, offset: number): [number, number] | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[offset + i];
    if (byte === undefined) return null;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return [value >>> 0, i + 1];
  }
  throw new Error("status reply: a length field is longer than five bytes");
}

function packet(...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([varInt(body.length), body]);
}

/** The status JSON, once the whole packet has arrived; null until then. */
function replyJson(buf: Buffer): string | null {
  const length = readVarInt(buf, 0);
  if (!length) return null;
  const [packetLength, lengthSize] = length;
  if (packetLength > MAX_REPLY_BYTES) throw new Error("status reply: implausibly large");
  if (buf.length < lengthSize + packetLength) return null;

  const body = buf.subarray(lengthSize, lengthSize + packetLength);
  const id = readVarInt(body, 0);
  if (!id || id[0] !== 0x00) throw new Error("status reply: not a status response packet");
  const text = readVarInt(body, id[1]);
  if (!text) throw new Error("status reply: truncated");
  const start = id[1] + text[1];
  return body.subarray(start, start + text[0]).toString("utf8");
}

function exchange(host: string, port: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let received = Buffer.alloc(0);
    let settled = false;

    const finish = (err: Error | null, json?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(json ?? "");
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(new Error("status ping timed out")));
    socket.once("error", (err) => finish(err));
    socket.once("close", () => finish(new Error("connection closed before a status reply")));

    socket.once("connect", () => {
      const hostBytes = Buffer.from(host, "utf8");
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      socket.write(
        Buffer.concat([
          packet(
            varInt(0x00),
            varInt(HANDSHAKE_PROTOCOL),
            varInt(hostBytes.length),
            hostBytes,
            portBytes,
            varInt(1),
          ),
          packet(varInt(0x00)),
        ]),
      );
    });

    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      try {
        const json = replyJson(received);
        if (json !== null) finish(null, json);
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

/**
 * The MOTD is a chat component: a bare string, or an object with `text` and
 * nested `extra`. Flattened to plain text, with legacy `§x` codes removed.
 */
function plainText(component: unknown): string {
  if (typeof component === "string") return component;
  if (Array.isArray(component)) return component.map(plainText).join("");
  if (component && typeof component === "object") {
    const node = component as { text?: unknown; extra?: unknown };
    return (typeof node.text === "string" ? node.text : "") + plainText(node.extra ?? "");
  }
  return "";
}

interface RawStatus {
  version?: { name?: unknown; protocol?: unknown };
  players?: { online?: unknown; max?: unknown; sample?: unknown };
  description?: unknown;
  favicon?: unknown;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export async function readStatus(opts: StatusOptions): Promise<StatusResult> {
  const started = Date.now();
  try {
    const json = await exchange(opts.host, opts.port ?? 25565, opts.timeoutMs ?? 10_000);
    const latencyMs = Date.now() - started;
    const res = JSON.parse(json) as RawStatus;
    const sample = Array.isArray(res.players?.sample) ? res.players.sample : [];
    return {
      online: true,
      playersOnline: count(res.players?.online),
      playersMax: count(res.players?.max),
      sample: sample
        .map((p: unknown) => (p as { name?: unknown } | null)?.name)
        .filter((name): name is string => typeof name === "string"),
      motd: plainText(res.description).replace(/§./g, ""),
      favicon: typeof res.favicon === "string" ? res.favicon : null,
      versionName: typeof res.version?.name === "string" ? res.version.name : "unknown",
      protocol: count(res.version?.protocol),
      latencyMs,
    };
  } catch (err) {
    return { online: false, error: err instanceof Error ? err.message : String(err) };
  }
}
