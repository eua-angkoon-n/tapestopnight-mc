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

export interface RenderMeta {
  /** Stamped by the caller. The renderer takes no clock of its own so that
   *  rendering the same rows twice produces identical text. */
  readonly renderedAt?: string;
  readonly renderedBy?: string;
}

export function renderProperties(
  entries: ReadonlyArray<{ key: string; value: string }>,
  meta: RenderMeta = {},
): string {
  const lines = [...GENERATED_BANNER];

  if (meta.renderedAt) lines.push(`# rendered-at: ${meta.renderedAt}`);
  if (meta.renderedBy) lines.push(`# rendered-by: ${meta.renderedBy}`);
  lines.push("");

  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { key, value } of sorted) {
    lines.push(`${key}=${escapeValue(value)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Java Properties escaping, limited to what actually bites here.
 *
 * The MOTD is the field admins will paste odd characters into, and a literal
 * backslash or a newline in it would corrupt every line that follows.
 */
function escapeValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\n")
    .replaceAll("\r", "\r")
    .replaceAll("\t", "\t");
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

function unescapeValue(value: string): string {
  return value
    .replaceAll("\n", "\n")
    .replaceAll("\r", "\r")
    .replaceAll("\t", "\t")
    .replaceAll("\\\\", "\\");
}

/** Read the Desired Config and render it. */
export async function renderFromDb(db: Database, meta: RenderMeta = {}): Promise<string> {
  const rows = await db
    .select({ key: configKey.key, value: configKey.value })
    .from(configKey)
    .orderBy(asc(configKey.key));
  return renderProperties(rows, meta);
}
