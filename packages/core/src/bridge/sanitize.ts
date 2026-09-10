/**
 * The trust boundary.
 *
 * Text typed by a stranger on a public web page ends up inside a `tellraw`
 * argument, which is JSON, which is parsed by the Game Server. Everything here
 * exists because that sentence is true — this is the one part of the bridge
 * that must not be simplified away later for being "just string handling".
 *
 * Three separate problems, deliberately not merged:
 *
 *   1. **JSON injection.** The payload is BUILT with JSON.stringify, never
 *      interpolated. A quote in someone's message is then just a quote.
 *   2. **Formatting injection.** `§` is Minecraft's colour code prefix; left
 *      in, anyone could paint their text like a server announcement, or make
 *      it invisible. Stripped, not escaped.
 *   3. **Line injection.** A newline in a chat line is a second chat line.
 */

/** Minecraft refuses chat over 256 characters; the bridge decides earlier. */
export const MAX_BODY = 240;

/** C0 controls and DEL. Written as escapes so the source stays greppable. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Strip what must never reach the game, and bound the length.
 *
 * Returns the empty string for input that is nothing but control characters,
 * which callers treat as "there was no message" rather than sending a blank.
 */
export function sanitizeBody(raw: string): string {
  return raw
    .replace(/§/g, "") // § — colour and format codes
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_BODY);
}

/**
 * The `tellraw @a` command for one bridged message.
 *
 * The prefix names where the message came from, because a player who cannot
 * tell an in-game neighbour from someone typing on the website has no way to
 * judge what the sender can actually see.
 */
export function tellrawCommand(prefix: string, author: string, body: string): string {
  const payload = [
    { text: `[${prefix}] `, color: "gray" },
    { text: author, color: "aqua" },
    { text: ": ", color: "gray" },
    { text: body, color: "white" },
  ];
  return `tellraw @a ${JSON.stringify(payload)}`;
}

/**
 * A one-line message to a single player, in the server's own voice.
 *
 * Used for the replies to `!link`, which must not be broadcast: the whole
 * point of that exchange is that it identifies one person.
 */
export function tellrawNotice(target: string, text: string): string {
  const payload = [
    { text: "[เซิร์ฟเวอร์] ", color: "gray" },
    { text, color: "yellow" },
  ];
  return `tellraw ${target} ${JSON.stringify(payload)}`;
}
