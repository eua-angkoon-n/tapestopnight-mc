/**
 * Smoke test for the bot against LIVE services — `npm run bot:smoke`,
 * or in production via `docker compose run --rm --no-deps bot node
 * apps/bot/smoke-check.ts`.
 *
 * This drives the real handlers and the real guards against the real database,
 * the real RCON connection and the real container. Discord's transport is the
 * only thing stubbed, because that is the one part nobody can exercise from a
 * terminal — and it is also the part least likely to be wrong.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION. It never calls start, stop or restart, and
 * it writes nothing anywhere. The one command it sends the game is `players`,
 * which reads.
 *
 * The Minecraft version also exercised the Edit Tiers by attempting writes it
 * expected to be refused. There is no `/config` here to attempt them against —
 * see the note in `src/commands.ts` for why that command did not survive the
 * move to Project Zomboid.
 */
import { eq } from "drizzle-orm";

import { allowedChannel, createDb } from "@tapestopnight/core/db";
import { listPlayers } from "@tapestopnight/core/control";

import { env } from "./src/env.ts";
import { ADMIN_ONLY } from "./src/commands.ts";
import { adminGrantFor, channelAllowed, channelRefusalMessage, roleIdsOf } from "./src/guard.ts";
import { handleInfoIp, handleInfoSetup } from "./src/handlers/info.ts";
import { handlePlayersList } from "./src/handlers/players.ts";
import { handleStatus } from "./src/handlers/server.ts";

const { db, sql } = createDb();

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (pass) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** What a handler said, however it said it. */
interface Captured {
  text: string;
  embeds: number;
  files: number;
}

function fakeInteraction(opts: {
  userId: string;
  roleIds: string[];
  channelId: string;
  strings?: Record<string, string>;
  booleans?: Record<string, boolean>;
}) {
  const captured: Captured = { text: "", embeds: 0, files: 0 };

  const record = (payload: unknown) => {
    if (typeof payload === "string") {
      captured.text += payload;
      return;
    }
    const p = payload as {
      content?: string;
      embeds?: { data?: Record<string, unknown> }[];
      files?: unknown[];
    };
    if (p.content) captured.text += p.content;
    for (const embed of p.embeds ?? []) {
      captured.embeds++;
      const data = (embed.data ?? {}) as {
        title?: string;
        description?: string;
        fields?: { name: string; value: string }[];
        footer?: { text?: string };
      };
      captured.text += [
        data.title ?? "",
        data.description ?? "",
        ...(data.fields ?? []).map((f) => `${f.name}=${f.value}`),
        data.footer?.text ?? "",
      ].join(" | ");
    }
    captured.files += (p.files ?? []).length;
  };

  const interaction = {
    user: { id: opts.userId },
    member: { roles: opts.roleIds },
    channelId: opts.channelId,
    inGuild: () => true,
    options: {
      getString: (name: string, req?: boolean) => {
        const v = opts.strings?.[name];
        if (v === undefined && req) throw new Error(`missing required string option "${name}"`);
        return v ?? null;
      },
      getBoolean: (name: string) => opts.booleans?.[name] ?? null,
      getSubcommand: () => "",
      getFocused: () => "",
    },
    deferReply: async () => {},
    editReply: async (payload: unknown) => record(payload),
    followUp: async (payload: unknown) => record(payload),
    reply: async (payload: unknown) => record(payload),
  };

  return { interaction: interaction as never, captured };
}

const ADMIN_USER = process.env.SMOKE_ADMIN_ID ?? "000000000000000001";
const PLAIN_USER = "000000000000000002";
const BOGUS_CHANNEL = "999999999999999999";

try {
  // ── which channel is actually allowed ────────────────────────────
  const channels = await db
    .select({ id: allowedChannel.channelId })
    .from(allowedChannel)
    .where(eq(allowedChannel.enabled, true));
  const GOOD_CHANNEL = channels[0]?.id;
  if (!GOOD_CHANNEL) throw new Error("no enabled channel in allowed_channel — nothing to test with");
  console.log(`allowlist: ${channels.length} enabled channel(s)\n`);

  // ── 1. the channel gate ──────────────────────────────────────────
  console.log("channel allowlist (requirement 3.3)");
  const good = await channelAllowed(db, GOOD_CHANNEL);
  check("allowed channel passes", good.allowed, GOOD_CHANNEL);
  const bad = await channelAllowed(db, BOGUS_CHANNEL);
  check("unlisted channel refused", !bad.allowed, BOGUS_CHANNEL);
  const refusal = channelRefusalMessage(BOGUS_CHANNEL, bad.anyConfigured);
  check("refusal does not leak the INSERT once channels exist", !refusal.includes("INSERT"), refusal.slice(0, 60));

  // ── 2. ADR-0004 ──────────────────────────────────────────────────
  console.log("\nadmin authority (ADR-0004)");
  const asAdmin = fakeInteraction({
    userId: ADMIN_USER,
    roleIds: [env.adminRoleId],
    channelId: GOOD_CHANNEL,
  });
  const adminGrant = await adminGrantFor(db, asAdmin.interaction);
  check("role holder is admin", adminGrant.isAdmin, adminGrant.isAdmin ? adminGrant.via : "");

  const asPlain = fakeInteraction({
    userId: PLAIN_USER,
    roleIds: ["111111111111111111"],
    channelId: GOOD_CHANNEL,
  });
  const plainGrant = await adminGrantFor(db, asPlain.interaction);
  check("non-role holder is NOT admin", !plainGrant.isAdmin);
  check("roleIdsOf reads the raw member shape", roleIdsOf(asAdmin.interaction).length === 1);
  check(
    "every command that disconnects players is gated",
    ADMIN_ONLY.has("server stop") &&
      ADMIN_ONLY.has("server start") &&
      ADMIN_ONLY.has("server restart"),
  );

  // ── 3. RCON reaches Project Zomboid at all ───────────────────────
  /*
    Checked on its own, before the handlers that depend on it.

    `minecraft-server-util`'s RCON client could not log in to PZ — it rejects
    the empty type-0 packet PZ sends before the type-2 auth result — so
    core/control/rcon.ts is a hand-written Source RCON client. This assertion is
    what would catch that client regressing, and it names the thing that broke
    rather than leaving it to surface as "/players list said something odd".
  */
  console.log("\nRCON (hand-written Source client)");
  try {
    const names = await listPlayers(env.rcon);
    check("players command round-trips", Array.isArray(names), `${names.length} online`);
  } catch (err) {
    check("players command round-trips", false, err instanceof Error ? err.message : String(err));
  }

  // ── 4. read-only commands against live services ──────────────────
  console.log("\nread-only commands (live)");
  const run = async (
    name: string,
    fn: (i: never) => Promise<void>,
    expect?: (text: string, c: Captured) => boolean,
  ) => {
    const f = fakeInteraction({ userId: ADMIN_USER, roleIds: [env.adminRoleId], channelId: GOOD_CHANNEL });
    try {
      await fn(f.interaction);
      const ok = expect ? expect(f.captured.text, f.captured) : f.captured.text.length > 0;
      check(name, ok, f.captured.text.replace(/\s+/g, " ").slice(0, 90));
    } catch (err) {
      check(name, false, err instanceof Error ? err.message : String(err));
    }
  };

  await run(
    "/server status",
    handleStatus,
    (t, c) => c.embeds === 1 && /ออนไลน์|ปิดอยู่|ยังไม่ตอบ/.test(t),
  );

  /*
    The fallback message is NOT a pass.

    This assertion was originally just "said something", and it went green while
    RCON was unreachable — the handler's own "could not ask" text is a sentence,
    so the check was satisfied by the failure it existed to detect. A smoke test
    that accepts an error string as evidence of success is worse than none.
  */
  await run(
    "/players list",
    handlePlayersList,
    (t) => !t.includes("ถามรายชื่อผู้เล่นไม่สำเร็จ") && t.length > 0,
  );

  // Asserts the two manual installs are still named. They are the reason a
  // player cannot join, and a /info setup that quietly stopped mentioning them
  // would be worse than one that errored.
  await run(
    "/info setup",
    handleInfoSetup,
    (t, c) => c.embeds === 1 && t.includes("ZombieBuddy") && t.includes("pz3d"),
  );
  await run(
    "/info ip",
    handleInfoIp,
    (t) => t.includes(env.serverAddress) && t.includes(env.serverPort),
  );

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
} finally {
  await sql.end();
}

process.exit(failures === 0 ? 0 : 1);
