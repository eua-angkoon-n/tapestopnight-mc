/**
 * Turning one line of the Game Server log into an event.
 *
 * Pure functions over strings: no filesystem, no database, no Minecraft. That
 * is deliberate — the log formats below were captured from the real Host once
 * and then frozen as fixtures, and a parser that needs a running server to test
 * is a parser nobody re-tests after they change it. → apps/bot/bridge-check.ts
 *
 * ── Why the thread name is a security control, not decoration ──────────────
 *
 * Measured on the Host: a `say` issued over RCON comes back as
 *
 *   [16:52:51] [RCON Client #6/INFO] [net.minecraft.server.dedicated.DedicatedServer]: [Rcon] hello
 *
 * on the **RCON Client** thread, while a real player's chat is on the **Server
 * thread**. Accepting only `Server thread` means anything this bridge itself
 * pushes into the game can never be read back out of the log and re-delivered.
 * The bridge cannot echo itself, structurally, rather than by a filter someone
 * might later decide looks redundant.
 *
 * (`tellraw`, which is what the bridge actually uses, was measured to print
 * nothing to the log at all. The thread check is the belt to that's braces:
 * correct even if a future change reaches for `say`.)
 */

export type BridgeEvent =
  | { readonly kind: "chat"; readonly name: string; readonly body: string }
  | { readonly kind: "login"; readonly name: string; readonly ip: string };

/**
 * `[HH:MM:SS] [<thread>/<level>] [<logger>]: <payload>`
 *
 * The line carries NO date — only a wall clock. Every event is therefore
 * stamped with the reader's own clock, never with anything parsed from here.
 */
const LINE = /^\[\d{2}:\d{2}:\d{2}\] \[([^\]/]+)\/[A-Z]+\] \[([^\]]+)\]: (.*)$/;

/** Only this thread is a real player. See the note above. */
const PLAYER_THREAD = "Server thread";

/**
 * Loggers are matched exactly rather than by shape.
 *
 * The pack is 219 mods and its log is full of lines that look like chat by
 * accident — `[RB-Transformer]:  - <init>` and hundreds of `[STDOUT]` lines
 * carrying Java constructor names in angle brackets. Anchoring on the logger
 * that vanilla actually uses removes that entire class of false positive
 * instead of playing whack-a-mole with the payload pattern.
 */
const CHAT_LOGGER = "net.minecraft.server.dedicated.DedicatedServer";
const LOGIN_LOGGER = "net.minecraft.server.management.PlayerList";

/** Minecraft's own rule for a name. Anything else is not a player. */
const NAME = String.raw`[A-Za-z0-9_]{3,16}`;

const CHAT = new RegExp(String.raw`^<(${NAME})> (.+)$`);

/**
 * `tapestopnight[/124.122.223.96:3372] logged in with entity id 138 at (…)`
 *
 * The address is taken up to the LAST colon, not the first: an IPv6 peer is
 * written `[/2001:db8::1]:56789` and splitting on the first colon would record
 * `2001` as someone's address.
 */
const LOGIN = new RegExp(String.raw`^(${NAME})\[/(.+):\d+\] logged in with entity id`);

/** Returns null for the ~99.9% of lines that are not about a player. */
export function parseLine(line: string): BridgeEvent | null {
  const matched = LINE.exec(line);
  if (!matched) return null;

  const [, thread, logger, payload] = matched;
  if (thread !== PLAYER_THREAD || payload === undefined) return null;

  if (logger === LOGIN_LOGGER) {
    const login = LOGIN.exec(payload);
    if (!login?.[1] || !login[2]) return null;
    return { kind: "login", name: login[1], ip: login[2] };
  }

  if (logger !== CHAT_LOGGER) return null;

  const chat = CHAT.exec(payload);
  if (!chat?.[1] || !chat[2]) return null;
  return { kind: "chat", name: chat[1], body: chat[2] };
}

/** `!link 123456` typed in game. Returns the code, or null for ordinary chat. */
export function linkCommand(body: string): string | null {
  const matched = /^!link\s+([A-Za-z0-9]{4,12})\s*$/.exec(body);
  return matched?.[1]?.toUpperCase() ?? null;
}
