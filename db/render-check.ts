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

/*
  Escaping must survive a round trip.

  These are the cases that corrupt the file rather than merely looking odd:
  server.properties is line-oriented, so an unescaped newline in a MOTD turns
  the rest of the value into a garbage key and takes every following line with
  it. The escape helpers were previously no-ops — their right-hand sides were
  real control characters instead of the two-character sequences — and no test
  noticed, because the pack ships no value containing one.
*/
const AWKWARD: Record<string, string> = {
  "motd-newline": "line one\nline two",
  "motd-backslash": "C:\\path\\to\\thing",
  "motd-tab": "before\tafter",
  // The case a chain of replaceAll gets wrong: a literal backslash, then "n".
  "motd-backslash-n": "literal\\nnot-a-newline",
};
for (const [key, value] of Object.entries(AWKWARD)) {
  const back = parseProperties(renderProperties([{ key, value }])).get(key);
  if (back !== value) {
    problems.push(`ESCAPE    ${key}: ${JSON.stringify(value)} -> ${JSON.stringify(back)}`);
  }
}
if (renderProperties([{ key: "motd", value: "a\nb" }]).split("\n").filter((l) => l.startsWith("motd=")).length !== 1) {
  problems.push("ESCAPE    a newline in a value split the file across two lines");
}

/*
  Secrets are injected, never stored (SECRET_KEYS).

  ADR-0003 displays locked keys WITH their values on the admin page, so an
  rcon.password row would print the password to every admin. A stored row is
  therefore dropped rather than trusted, and the environment value used.
*/
const withSecret = renderProperties(
  [
    { key: "enable-rcon", value: "true" },
    { key: "rcon.password", value: "leaked-from-the-database" },
  ],
  {},
  { "rcon.password": "injected-from-env" },
);
if (parseProperties(withSecret).get("rcon.password") !== "injected-from-env") {
  problems.push("SECRET    the injected value did not win over the stored row");
}
if (withSecret.includes("leaked-from-the-database")) {
  problems.push("SECRET    a stored rcon.password row reached the rendered file");
}
if (parseProperties(renderProperties([{ key: "rcon.password", value: "x" }])).has("rcon.password")) {
  problems.push("SECRET    rcon.password rendered from the database with no secret supplied");
}

console.log(`source   : ${path}`);
console.log(`escaping : ${Object.keys(AWKWARD).length} awkward values round-tripped`);
console.log(`secrets  : rcon.password injected; stored row ignored`);
console.log(`keys     : ${original.size} in, ${roundTripped.size} out`);
console.log(`banner   : ${hasBanner ? "present" : "ABSENT"}`);
console.log(`comment lines added: ${rendered.split("\n").filter((l) => l.startsWith("#")).length}`);

if (problems.length) {
  console.error(`\nFAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS - every key and value survives the round trip; only the banner is new");
