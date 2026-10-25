/**
 * Verification for the command tree — `npm run bot:check`.
 *
 * The plan's Phase 6 verification asks for two things that are cheaper to
 * assert than to remember:
 *
 *   1. Every subcommand has a decided authorisation tier. A new subcommand
 *      added without a decision defaults to public, which is the wrong way for
 *      that mistake to fail — so this refuses to pass until it is listed.
 *   2. Nothing in the tree can stop, reboot or shut down the HOST. The prior
 *      art this replaces had a `pc_shutdown`; the equivalent here would take
 *      the unrelated ledger system down with it.
 *
 * Needs no token, no database and no network: it inspects the JSON the bot
 * would register. Imports commands.ts only — env.ts would demand a real
 * configuration to answer a question about static structure.
 */
import { ADMIN_ONLY, buildCommands } from "./src/commands.ts";

/**
 * Subcommands anyone in an allowed channel may run.
 *
 * Every one of these exposes only what a Server List Ping already tells the
 * whole internet, or what the public website shows.
 */
const PUBLIC: ReadonlySet<string> = new Set([
  "server status",
  "players list",
  "info modpack",
  "info ip",
  "info download",
  "info icon",
]);

/** Words that would indicate a command reaching past the container. */
const HOST_CONTROL = [
  "shutdown",
  "reboot",
  "poweroff",
  "halt",
  "host",
  "ssh",
  "exec",
  "shell",
  "sudo",
  "reinstall",
];

interface Leaf {
  readonly route: string;
  readonly description: string;
}

function leaves(): Leaf[] {
  const out: Leaf[] = [];
  for (const command of buildCommands()) {
    const options = (command.options ?? []) as {
      name: string;
      description: string;
      type: number;
      options?: { name: string; description: string; type: number }[];
    }[];

    const subcommands = options.filter((o) => o.type === 1); // SUB_COMMAND
    if (subcommands.length === 0) {
      out.push({ route: command.name, description: command.description });
      continue;
    }
    for (const sub of subcommands) {
      out.push({ route: `${command.name} ${sub.name}`, description: sub.description });
    }
  }
  return out;
}

const problems: string[] = [];
const all = leaves();

console.log("command tree\n");
for (const leaf of all) {
  const admin = ADMIN_ONLY.has(leaf.route);
  const pub = PUBLIC.has(leaf.route);

  let tier: string;
  if (admin && pub) {
    tier = "BOTH?!";
    problems.push(`${leaf.route} is listed as both admin-only and public`);
  } else if (admin) {
    tier = "admin";
  } else if (pub) {
    tier = "public";
  } else {
    tier = "UNDECIDED";
    problems.push(
      `${leaf.route} has no authorisation tier — add it to ADMIN_ONLY in ` +
        `src/commands.ts or to PUBLIC in this file, deliberately`,
    );
  }

  console.log(`  ${tier.padEnd(9)} /${leaf.route.padEnd(16)} ${leaf.description}`);
}

// Tiers listed for routes that no longer exist are stale and would quietly
// stop protecting anything.
for (const route of ADMIN_ONLY) {
  if (!all.some((l) => l.route === route)) {
    problems.push(`ADMIN_ONLY lists "${route}", which is not in the tree`);
  }
}
for (const route of PUBLIC) {
  if (!all.some((l) => l.route === route)) {
    problems.push(`PUBLIC lists "${route}", which is not in the tree`);
  }
}

console.log("\nhost-control check");
for (const leaf of all) {
  const haystack = `${leaf.route} ${leaf.description}`.toLowerCase();
  const hit = HOST_CONTROL.find((word) => haystack.includes(word));
  if (hit) {
    problems.push(`/${leaf.route} mentions "${hit}" — nothing may reach past the container`);
  }
}
console.log(
  `  scanned ${all.length} commands for ${HOST_CONTROL.length} host-control terms — ` +
    `${problems.length === 0 ? "none present" : "see below"}`,
);

const adminCount = all.filter((l) => ADMIN_ONLY.has(l.route)).length;
console.log(`\n${all.length} commands · ${adminCount} admin-only · ${all.length - adminCount} public`);

if (problems.length) {
  console.error(`\nFAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS - every command has a decided tier, and none can touch the Host");
