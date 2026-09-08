/**
 * Phase 3 verification, per the plan: prove the renderer is faithful BEFORE it
 * is ever allowed to touch the live server.properties.
 *
 * Deliberately needs no database. It exercises the renderer in isolation, so a
 * failure here means the renderer is wrong rather than the data being wrong.
 *
 * The plan phrased this as "diff against the pack's original; they should
 * differ only by the header". Compared as parsed key -> value maps rather than
 * as raw text, because the renderer sorts keys and the pack's file is in Java
 * Properties write order. A textual diff would report every line as moved and
 * bury any real difference. Comparing parsed pairs asks the question that
 * matters: is every key present, and is every value identical.
 *
 *   node --experimental-strip-types db/render-check.ts <path-to-original>
 */
import { readFileSync } from "node:fs";

import { parseProperties, renderProperties } from "../packages/core/src/config/index.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: render-check.ts <path-to-server.properties>");
  process.exit(2);
}

const originalText = readFileSync(path, "utf8");
const original = parseProperties(originalText);
if (original.size === 0) {
  console.error(`no properties parsed from ${path}`);
  process.exit(2);
}

const rendered = renderProperties([...original].map(([key, value]) => ({ key, value })));
const roundTripped = parseProperties(rendered);

const problems: string[] = [];

for (const [key, value] of original) {
  if (!roundTripped.has(key)) {
    problems.push(`MISSING   ${key}`);
  } else if (roundTripped.get(key) !== value) {
    problems.push(`CHANGED   ${key}: ${JSON.stringify(value)} -> ${JSON.stringify(roundTripped.get(key))}`);
  }
}
for (const key of roundTripped.keys()) {
  if (!original.has(key)) problems.push(`INVENTED  ${key}`);
}

// The banner is the only thing allowed to be new, and it must be present:
// without it a future admin has no warning that hand edits are discarded.
const hasBanner = rendered.includes("GENERATED FILE - DO NOT EDIT");
if (!hasBanner) problems.push("MISSING   the GENERATED banner (ADR-0002 requires it)");

// Rendering identical input twice must produce identical output, or diffs
// between renders become unreadable.
if (renderProperties([...original].map(([key, value]) => ({ key, value }))) !== rendered) {
  problems.push("UNSTABLE  renderer is not deterministic");
}

console.log(`source   : ${path}`);
console.log(`keys     : ${original.size} in, ${roundTripped.size} out`);
console.log(`banner   : ${hasBanner ? "present" : "ABSENT"}`);
console.log(`comment lines added: ${rendered.split("\n").filter((l) => l.startsWith("#")).length}`);

if (problems.length) {
  console.error(`\nFAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS - every key and value survives the round trip; only the banner is new");
