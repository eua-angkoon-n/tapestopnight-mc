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

/*
  Secret keys are excluded from the round trip, and the exclusion is the point
  rather than a concession.

  `rcon.password` is in SECRET_KEYS, so the renderer drops any stored row for
  it and takes the value from the environment instead — that is the whole
  design (ADR-0002), and it means a secret key CANNOT round-trip through the
  database by construction. Homestead's server.properties ships the key with an
  empty value; Dregora's did not, which is the only reason this check passed
  without the carve-out until now.

  Comparing it anyway would report MISSING for a renderer behaving exactly as
  specified, and the fix somebody reached for under time pressure would be to
  delete the line from the fixture — quietly ending the guarantee that the
  fixture is the pack's file verbatim. The secret path has its own assertions
  further down, which are stricter than this one.
*/
const SECRET_IN_FIXTURE = new Set(["rcon.password"]);

const renderable = [...original].filter(([key]) => !SECRET_IN_FIXTURE.has(key));
const rendered = renderProperties(renderable.map(([key, value]) => ({ key, value })));
const roundTripped = parseProperties(rendered);

const problems: string[] = [];

for (const [key, value] of renderable) {
  if (!roundTripped.has(key)) {
    problems.push(`MISSING   ${key}`);
  } else if (roundTripped.get(key) !== value) {
    problems.push(`CHANGED   ${key}: ${JSON.stringify(value)} -> ${JSON.stringify(roundTripped.get(key))}`);
  }
}
for (const key of roundTripped.keys()) {
  if (!original.has(key)) problems.push(`INVENTED  ${key}`);
}

// The carve-out must stay a carve-out: if the renderer ever DID emit a secret
// from a stored row, skipping the comparison above would hide it. Assert the
// absence directly.
for (const key of SECRET_IN_FIXTURE) {
  if (roundTripped.has(key)) problems.push(`SECRET    ${key} was rendered from a stored row`);
}

// The banner is the only thing allowed to be new, and it must be present:
// without it a future admin has no warning that hand edits are discarded.
const hasBanner = rendered.includes("GENERATED FILE - DO NOT EDIT");
if (!hasBanner) problems.push("MISSING   the GENERATED banner (ADR-0002 requires it)");

// Rendering identical input twice must produce identical output, or diffs
// between renders become unreadable.
if (renderProperties(renderable.map(([key, value]) => ({ key, value }))) !== rendered) {
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
  // Colour codes. These reached the file and went no further: the backslash
  // rule escaped `§` to `\\u00A7`, Java read a literal backslash followed by
  // u00A7, and the MOTD displayed the escape sequence instead of a colour.
  "motd-section": "§6§lfrom the§8§l §mdepths§r §6§lof the §4§l§onether",
  "motd-thai": "เซิร์ฟเวอร์ Homestead",
  // Astral plane: Java wants a surrogate pair as two escapes, which is how a
  // JS string already holds it.
  "motd-astral": "boss 🐉 down",
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
  The rendered file must be pure ASCII.

  Not a style rule — it is the whole reason non-ASCII is escaped. We write this
  file and Minecraft reads it, and Java's Properties has historically read a
  .properties stream as ISO-8859-1. A `§` written as UTF-8 is the two bytes
  C2 A7, which a Latin-1 reader shows as `Â§`; Thai fares far worse. A \uXXXX
  escape decodes identically whichever way the file is read, so the encoding
  stops being a question anyone has to get right.
*/
const nonAscii = [...renderProperties(Object.entries(AWKWARD).map(([key, value]) => ({ key, value })))]
  .filter((c) => c.charCodeAt(0) > 0x7e);
if (nonAscii.length > 0) {
  problems.push(
    `ENCODING  ${nonAscii.length} non-ASCII character(s) reached the file: ${JSON.stringify(nonAscii.join(""))}`,
  );
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
console.log(
  `keys     : ${original.size} in, ${roundTripped.size} out` +
    (original.size !== renderable.length
      ? ` (${original.size - renderable.length} secret held back — see SECRET_IN_FIXTURE)`
      : ""),
);
console.log(`banner   : ${hasBanner ? "present" : "ABSENT"}`);
console.log(`comment lines added: ${rendered.split("\n").filter((l) => l.startsWith("#")).length}`);

if (problems.length) {
  console.error(`\nFAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS - every key and value survives the round trip; only the banner is new");
