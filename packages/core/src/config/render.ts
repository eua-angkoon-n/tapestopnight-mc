import { asc } from "drizzle-orm";

import { configKey, type Database } from "../db/index.ts";

/**
 * Render the Desired Config to server.properties text — ADR-0002.
 *
 * Minecraft can only read this from disk at process start; it cannot talk to
 * Postgres. That makes a materialisation step unavoidable, and ADR-0002 settles
 * which side wins: Postgres is authoritative and this output is owned by
 * nobody. Hand edits survive until the next Apply and are then gone, which is
 * why the banner is loud and not a courtesy.
 *
 * Output is sorted by key. Deterministic order means a diff between two renders
 * shows what actually changed rather than a reshuffle.
 */

export const GENERATED_BANNER = [
  "#############################################################################",
  "#                                                                           #",
  "#   GENERATED FILE - DO NOT EDIT                                            #",
  "#                                                                           #",
  "#   Rendered from the Postgres `config_key` table (ADR-0002).               #",
  "#   Editing this file by hand does nothing lasting: the next Apply from     #",
  "#   the admin panel overwrites it completely and your change is lost with   #",
  "#   no warning.                                                             #",
  "#                                                                           #",
  "#   To change a value, use the admin panel. Keys are tiered FREE / GUARDED  #",
  "#   / LOCKED (ADR-0003); a LOCKED key cannot be changed there because       #",
  "#   changing it would break or destroy the world.                           #",
  "#                                                                           #",
  "#############################################################################",
];

/**
 * Keys whose value is a SECRET and must never live in the `config_key` table.
 *
 * ADR-0003 deliberately DISPLAYS locked keys on the admin page, with their
 * values, so that nobody goes hunting for the file over SSH. `rcon.password`
 * is locked — so storing it as a row would print the RCON password to every
 * admin who opens /config. It is therefore supplied at render time from the
 * environment instead, and a row of this name is ignored if one ever appears.
 *
 * The secret consequently lives in exactly one place: deploy/.env, which is
 * gitignored and readable only by root on the Host.
 */
export const SECRET_KEYS: ReadonlySet<string> = new Set(["rcon.password"]);

/** Secret values injected at render time. Keys must be in SECRET_KEYS. */
export type RenderSecrets = Readonly<Record<string, string>>;

export interface RenderMeta {
  /** Stamped by the caller. The renderer takes no clock of its own so that
   *  rendering the same rows twice produces identical text. */
  readonly renderedAt?: string;
  readonly renderedBy?: string;
}

export function renderProperties(
  entries: ReadonlyArray<{ key: string; value: string }>,
  meta: RenderMeta = {},
  secrets: RenderSecrets = {},
): string {
  const lines = [...GENERATED_BANNER];

  if (meta.renderedAt) lines.push(`# rendered-at: ${meta.renderedAt}`);
  if (meta.renderedBy) lines.push(`# rendered-by: ${meta.renderedBy}`);
  lines.push("");

  // A stored row for a secret key is dropped rather than trusted, so a stray
  // INSERT can neither leak onto the admin page nor override the environment.
  const merged = new Map<string, string>();
  for (const { key, value } of entries) {
    if (SECRET_KEYS.has(key)) continue;
    merged.set(key, value);
  }
  for (const [key, value] of Object.entries(secrets)) {
    if (value) merged.set(key, value);
  }

  const sorted = [...merged, ].map(([key, value]) => ({ key, value }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { key, value } of sorted) {
    lines.push(`${key}=${escapeValue(value)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Java Properties escaping, limited to what actually bites here.
 *
 * The MOTD is the field admins paste odd characters into, and an unescaped
 * newline in it corrupts every line that follows: server.properties is
 * line-oriented, so the remainder of the value is read as a garbage key.
 *
 * The last three replacements used to be no-ops. Their right-hand sides were
 * the real control characters rather than the two-character escape sequences,
 * so `.replaceAll("\n", "\n")` replaced a newline with a newline.
 *
 * ── Why non-ASCII is written as \uXXXX and not as itself ─────────────────────
 *
 * Because the file's encoding is not ours to decide. We write it; Minecraft
 * reads it, and Java's Properties has historically read a .properties stream as
 * ISO-8859-1. A `§` written as UTF-8 is the two bytes C2 A7, which a Latin-1
 * reader renders as `Â§` — the classic mangled MOTD — and Thai text fares far
 * worse. A `\uXXXX` escape is pure ASCII on the wire and decodes identically
 * whichever way the file is read, which is exactly why Java properties files
 * have always carried non-ASCII this way.
 *
 * The bug this fixes, stated plainly so it is not reintroduced: a `§` written
 * by an admin as the six characters `§` used to reach the file and go no
 * further, because the backslash rule below escaped it to `\\u00A7`. Java then
 * read "a literal backslash, then u00A7", and the MOTD displayed the escape
 * sequence itself rather than a colour.
 *
 * Escaping per UTF-16 code unit is deliberate, not lazy: Java expects an astral
 * character as two escapes, which is exactly how a JS string already holds it.
 */
function escapeValue(value: string): string {
  let out = "";
  for (const char of value) {
    if (char === "\\") {
      out += "\\\\";
    } else if (char === "\n") {
      out += "\\n";
    } else if (char === "\r") {
      out += "\\r";
    } else if (char === "\t") {
      out += "\\t";
    } else if (char >= " " && char <= "~") {
      out += char;
    } else {
      for (let i = 0; i < char.length; i++) {
        out += "\\u" + char.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
      }
    }
  }
  return out;
}

/** Parse a server.properties file into key -> value, ignoring comments. */
export function parseProperties(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out.set(line.slice(0, eq).trim(), unescapeValue(line.slice(eq + 1)));
  }
  return out;
}

/**
 * Single pass, deliberately.
 *
 * A chain of replaceAll cannot undo the escaping correctly. After escaping,
 * the three characters `\`, `\`, `n` mean "a literal backslash, then the
 * letter n" — but a chain that rewrites `\n` first turns them into a newline.
 * Scanning once and consuming whatever follows each backslash is the only
 * version that round-trips. An unknown escape yields the bare character,
 * matching Java Properties.
 */
function unescapeValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const next = value[++i];
    if (next === "u") {
      // \uXXXX — the form every non-ASCII character is written in. Four hex
      // digits, and if they are not there this is not an escape at all, so the
      // bare `u` is kept rather than silently eating the rest of the line.
      const hex = value.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
      out += "u";
      continue;
    }
    out += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : (next ?? "");
  }
  return out;
}

/** Read the Desired Config and render it. */
export async function renderFromDb(
  db: Database,
  meta: RenderMeta = {},
  secrets: RenderSecrets = {},
): Promise<string> {
  const rows = await db
    .select({ key: configKey.key, value: configKey.value })
    .from(configKey)
    .orderBy(asc(configKey.key));
  return renderProperties(rows, meta, secrets);
}
