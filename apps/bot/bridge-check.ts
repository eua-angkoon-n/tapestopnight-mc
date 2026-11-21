/**
 * Verification for the Chat Bridge — `npm run bridge:check`.
 *
 * Needs no token, no database, no Game Server: the parser and the sanitiser are
 * pure functions over strings, and the tailer is exercised against a temporary
 * file. The log samples below were captured from the Host on 2026-09-10 and are
 * the record of what the real thing emits — the parser was written to match
 * these, not the other way round.
 *
 * Four things are checked, and each one is a bug that already happened or
 * almost did:
 *
 *   1. The formats it must recognise, so a change to the regexes cannot
 *      silently stop the bridge (which fails by going QUIET, not by erroring).
 *   2. The lines it must ignore. This pack's log is 219 mods deep and full of
 *      text that looks like chat — `[RB-Transformer]:  - <init>` was found in
 *      the real log while designing this.
 *   3. That nothing the bridge itself says can be read back in. An RCON `say`
 *      lands on the "RCON Client" thread; accepting it would put the bridge in
 *      a loop with itself.
 *   4. That the tailer starts at the end, waits for half-written lines, and
 *      survives rotation — all three fail silently if they are wrong.
 */
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Imported through the workspace package, not by relative path: this also
// proves the "./bridge" entry in packages/core/package.json resolves, which
// is the difference between a check that passes and a bot that starts.
import { linkCommand, parseLine, sanitizeBody, tellrawCommand } from "@tapestopnight/core/bridge";

/*
  Imported for two reasons, and the second one is not obvious.

  The bot runs under `node --experimental-strip-types`, which erases type
  annotations but performs no TRANSFORMS. TypeScript that needs one — a
  constructor parameter property, an enum, a namespace — is perfectly valid to
  `tsc --noEmit` and is REFUSED BY NODE at import time. That shipped once: the
  bot crash-looped on boot with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX while every
  check in CI was green. Importing the tailer here means this file cannot pass
  unless the runtime can actually load it.
*/
import { LogTailer } from "./src/bridge/tailer.ts";

const problems: string[] = [];

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  FAIL  ${name}`);
  }
}

console.log("recognised formats (captured from the Host)");

await check("chat", () => {
  const event = parseLine(
    "[22:42:12] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <tapestopnight> สวัสดีครับ",
  );
  assert.deepEqual(event, { kind: "chat", name: "tapestopnight", body: "สวัสดีครับ" });
});

await check("login carries the address", () => {
  const event = parseLine(
    "[22:42:12] [Server thread/INFO] [net.minecraft.server.management.PlayerList]: tapestopnight[/124.122.223.96:3372] logged in with entity id 138 at (2461.5, 67.0, -2435.5)",
  );
  assert.deepEqual(event, { kind: "login", name: "tapestopnight", ip: "124.122.223.96" });
});

await check("an IPv6 peer keeps its whole address", () => {
  const event = parseLine(
    "[22:42:12] [Server thread/INFO] [net.minecraft.server.management.PlayerList]: tapestopnight[/2001:db8::1:56789] logged in with entity id 1 at (0.0, 0.0, 0.0)",
  );
  // Split on the FIRST colon and this would record "2001" as somebody's address,
  // which would then match every other IPv6 player on earth.
  assert.deepEqual(event, { kind: "login", name: "tapestopnight", ip: "2001:db8::1" });
});

await check("chat on Fabric, which prints no logger", () => {
  const event = parseLine("[21:14:34] [Server thread/INFO]: <tapestopnight> ฟหกฟหก");
  assert.deepEqual(event, { kind: "chat", name: "tapestopnight", body: "ฟหกฟหก" });
});

await check("login on Fabric", () => {
  const event = parseLine(
    "[21:06:00] [Server thread/INFO]: tapestopnight[/124.122.223.96:3372] logged in with entity id 1042 at (410.143, 29.0, 1084.357)",
  );
  assert.deepEqual(event, { kind: "login", name: "tapestopnight", ip: "124.122.223.96" });
});

console.log("\nlines that must be ignored");

const IGNORED = [
  // The loop this bridge cannot be allowed to enter. Real output, measured:
  // an RCON `say` comes back on a different thread from player chat.
  "[16:52:51] [RCON Client #6/INFO] [net.minecraft.server.dedicated.DedicatedServer]: [Rcon] bridge-say-9f3a",
  // Found in the real log. Angle brackets, right shape, not chat.
  "[10:13:23] [Server thread/INFO] [RB-Transformer]:  - <init>",
  "[10:12:36] [Server thread/INFO] [STDOUT]: [atomicstryker.battletowers.common.TowerStageItemManager:<init>:72]: parsed",
  "[14:12:40] [Server thread/INFO] [STDOUT]: [LycanitesMobs] [Info] Mob Event Started: Reptile Ruckus",
  "[10:13:34] [Server thread/INFO] [FML]: Unloading dimension 1",
  // Prominence II on Fabric, from the real log. No logger to anchor on, so
  // these are refused by the shape of the payload alone.
  "[00:05:18] [Server thread/INFO]: [Handshake] Sending channel query",
  "[00:05:18] [Server thread/INFO]: First spawn: placing new player GUSCHAN directly in Vaaz",
  "[00:34:19] [Server thread/INFO]: TexTureEz was slain by Zombie",
  "[00:12:14] [Server thread/INFO]: GUSCHAN joined the game",
  "[00:20:11] [Server thread/INFO]: GUSCHAN has made the advancement ['X' Marks the Spot]",
  "[00:09:40] [Server thread/INFO]: ThreadedAnvilChunkStorage (prominence): All chunks are saved",
  // An RCON-thread line on Fabric must stay as invisible as it is on Forge.
  "[16:52:51] [RCON Client #6/INFO]: <tapestopnight> not really a player",
  "",
  "not a log line at all",
];

for (const line of IGNORED) {
  await check(`ignores: ${line.slice(0, 58) || "(empty)"}`, () => {
    assert.equal(parseLine(line), null);
  });
}

console.log("\nthe trust boundary");

await check("colour codes are stripped", () => {
  assert.equal(sanitizeBody("§chello §lworld"), "chello lworld");
});

await check("newlines cannot smuggle a second line", () => {
  assert.equal(sanitizeBody("hello\nworld"), "hello world");
  assert.equal(sanitizeBody("a\tb"), "a b");
});

await check("a message of nothing but control characters becomes nothing", () => {
  assert.equal(sanitizeBody("\n\t   "), "");
});

await check("length is bounded", () => {
  assert.equal(sanitizeBody("x".repeat(500)).length, 240);
});

await check("quotes and braces cannot break out of the tellraw JSON", () => {
  const hostile = '"}],"extra":[{"text":"pwned';
  const command = tellrawCommand("เว็บ", "tapestopnight", hostile);

  // The proof is not that it looks escaped — it is that the argument parses
  // back to exactly one array whose last element is the hostile text, intact
  // and inert.
  const json = command.slice("tellraw @a ".length);
  const parsed = JSON.parse(json) as { text: string }[];
  assert.equal(parsed.length, 4);
  assert.equal(parsed[3]?.text, hostile);
});

console.log("\nthe tailer");

const seen: string[] = [];
const dir = await mkdtemp(join(tmpdir(), "bridge-check-"));
const logPath = join(dir, "latest.log");
const chatLine = (name: string, body: string) =>
  `[12:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: <${name}> ${body}`;

const tailer = new LogTailer({
  path: logPath,
  onError: (m) => seen.push(`ERROR:${m}`),
  onEvent: async (e) => {
    seen.push(e.kind === "chat" ? `${e.name}:${e.body}` : `${e.kind}:${e.name}`);
  },
});

try {
  await check("a missing log is survived, not thrown on", async () => {
    await tailer.tick();
    assert.deepEqual(seen, []);
  });

  const old = chatLine("olduser", "said this hours ago") + "\n";

  await check("an existing log is NOT replayed on first sight", async () => {
    await writeFile(logPath, old);
    await tailer.tick();
    // The whole point of starting at the end. Replaying would push hours of
    // old conversation into Discord as if it had just been said, and there is
    // no un-sending it.
    assert.deepEqual(seen, []);
  });

  await check("new lines are picked up", async () => {
    await writeFile(logPath, old + chatLine("alice", "hello") + "\n");
    await tailer.tick();
    assert.deepEqual(seen, ["alice:hello"]);
  });

  await check("a half-written line waits for the rest of itself", async () => {
    const sofar = old + chatLine("alice", "hello") + "\n";
    await writeFile(logPath, sofar + "[12:00:01] [Server thread/INFO] [net.minecraft.server.dedi");
    await tailer.tick();
    assert.deepEqual(seen, ["alice:hello"], "a partial line must not be parsed");

    await writeFile(logPath, sofar + chatLine("bob", "hi") + "\n");
    await tailer.tick();
    assert.deepEqual(seen, ["alice:hello", "bob:hi"]);
  });

  await check("a rotated (truncated) log is re-read from the start", async () => {
    // What happens at midnight and on every server restart. Getting this wrong
    // fails SILENTLY: the offset sits past the end of a shorter file and chat
    // simply stops, with nothing anywhere saying why.
    seen.length = 0;
    await writeFile(logPath, chatLine("carol", "after the restart") + "\n");
    await tailer.tick();
    assert.deepEqual(seen, ["carol:after the restart"]);
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("\nthe link command");

await check("a code is recognised and normalised", () => {
  assert.equal(linkCommand("!link ab12cd"), "AB12CD");
});

await check("ordinary chat is not a link command", () => {
  assert.equal(linkCommand("hello everyone"), null);
  assert.equal(linkCommand("!linkedin is a website"), null);
});

if (problems.length) {
  console.error(`\nFAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS - the bridge reads what the Host emits, ignores the rest, and cannot echo itself");
