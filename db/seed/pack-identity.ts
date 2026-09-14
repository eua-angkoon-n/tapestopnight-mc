/**
 * Which pack is deployed, read from the pin rather than typed out.
 *
 * deploy/modpack.lock is what fetch-modpack.sh verifies the archive against,
 * so it is already the one place that answers "what is running". Both seeders
 * read it from here: the row that the website and `/info modpack` display must
 * not be able to disagree with the zip that was actually unpacked.
 *
 * The row said "RLCraft Dregora v1.1.2b" because these strings were literals
 * in two files, and a literal is the copy nobody remembers to update.
 *
 * Shell assignments, parsed as such. The lock is sourced by the deploy scripts
 * and has to stay valid shell, so it cannot become JSON for our convenience —
 * this parser handles the subset it actually uses (KEY="value" and KEY=value,
 * one per line) and ignores the arrays and comments around them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "deploy", "modpack.lock");

export interface PackIdentity {
  readonly modpackName: string;
  readonly modpackVersion: string;
  readonly minecraftVersion: string;
  readonly loaderName: string;
  readonly loaderVersion: string;
  readonly downloadUrl: string;
  readonly wikiUrl: string;
}

function readLock(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    out.set(m[1]!, m[2]!.replace(/^"(.*)"$/, "$1"));
  }
  return out;
}

/**
 * Throws rather than defaulting.
 *
 * A blank modpack version does not degrade into something harmless: it seeds a
 * row that tells every visitor the wrong thing about which pack to install,
 * and "my client can't join" is the most expensive bug this project has.
 * LOADER_VERSION in particular ships empty on a fresh pin and has to be filled
 * in from the server pack before any of this is meaningful.
 */
function required(lock: Map<string, string>, key: string): string {
  const v = lock.get(key);
  if (!v) throw new Error(`deploy/modpack.lock is missing ${key} — fill it in before seeding`);
  return v;
}

export function packIdentity(path: string = LOCK): PackIdentity {
  const lock = readLock(path);
  return {
    modpackName: required(lock, "MODPACK_NAME"),
    modpackVersion: required(lock, "MODPACK_VERSION"),
    minecraftVersion: required(lock, "MINECRAFT_VERSION"),
    loaderName: required(lock, "LOADER_NAME"),
    loaderVersion: required(lock, "LOADER_VERSION"),
    downloadUrl: required(lock, "MODPACK_PAGE_URL"),
    wikiUrl: required(lock, "MODPACK_WIKI_URL"),
  };
}
