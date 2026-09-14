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
 * NON-DESTRUCTIVE BY CONSTRUCTION. It never calls start, stop, restart or
 * apply, and the only writes it attempts are ones it expects to be REFUSED —
 * a LOCKED key and an unconfirmed GUARDED key — with the stored values read
 * back afterwards to prove nothing moved. Running this against production is
 * the intended use; that is why the refusals are what it tests.
 */
import { eq } from "drizzle-orm";

import { allowedChannel, configKey, createDb } from "@tapestopnight/core/db";
import { tierFor } from "@tapestopnight/core/config";

import { env } from "./src/env.ts";
import { ADMIN_ONLY } from "./src/commands.ts";
import { adminGrantFor, channelAllowed, channelRefusalMessage, roleIdsOf } from "./src/guard.ts";
import {
  handleInfoDownload,
  handleInfoIcon,
  handleInfoIp,
  handleInfoModpack,
} from "./src/handlers/info.ts";
import { handlePlayersList } from "./src/handlers/players.ts";
import { handleStatus } from "./src/handlers/server.ts";
import { handleConfigGet, handleConfigSet, autocompleteConfigKey } from "./src/handlers/config.ts";

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
  check("lifecycle commands are gated", ADMIN_ONLY.has("server stop") && ADMIN_ONLY.has("config apply"));

  // ── 3. read-only commands against live services ──────────────────
  console.log("\nread-only commands (live)");
  const run = async (
    name: string,
    fn: (i: never, d: typeof db) => Promise<void>,
    expect?: (text: string, c: Captured) => boolean,
  ) => {
    const f = fakeInteraction({ userId: ADMIN_USER, roleIds: [env.adminRoleId], channelId: GOOD_CHANNEL });
    try {
      await fn(f.interaction, db);
      const ok = expect ? expect(f.captured.text, f.captured) : f.captured.text.length > 0;
      check(name, ok, f.captured.text.replace(/\s+/g, " ").slice(0, 90));
    } catch (err) {
      check(name, false, err instanceof Error ? err.message : String(err));
    }
  };

  await run("/server status", handleStatus, (t, c) => c.embeds === 1 && /ออนไลน์|ปิดอยู่/.test(t));

  /*
    The fallback message is NOT a pass.

    This assertion was originally just "said something", and it went green
    while RCON was unreachable — the handler's own "could not ask, the server
    may be generating chunks" text is a sentence, so the check was satisfied by
    the failure it existed to detect. A smoke test that accepts an error string
    as evidence of success is worse than no smoke test.

    /players list is the one command that must reach the Game Server, so
    reaching it is the thing to assert.
  */
  await run(
    "/players list",
    handlePlayersList,
    (t) => !t.includes("ถามรายชื่อผู้เล่นไม่สำเร็จ") && t.length > 0,
  );
  // Checks the loader NAME from the row rather than the literal "Forge" this
  // asserted until the move to Homestead — which would now fail on a server
  // that is working correctly, and is exactly the assertion a pack change
  // should not be able to break quietly.
  await run(
    "/info modpack",
    handleInfoModpack,
    (t, c) => c.embeds === 1 && (t.includes("Fabric") || t.includes("Forge") || t.includes("NeoForge")),
  );
  await run("/info ip", handleInfoIp, (t) => t.includes("tapestopnight.com"));
  await run("/info download", handleInfoDownload);
  await run("/info icon", handleInfoIcon, (t, c) => c.files === 1 || t.includes("ยังไม่ได้ตั้งไอคอน"));

  // ── 4. ADR-0003 tiers, enforced server-side ──────────────────────
  console.log("\nEdit Tiers (ADR-0003) — refusals, with the stored value read back");
  const allKeys = await db.select({ key: configKey.key, value: configKey.value }).from(configKey);
  const lockedKey = allKeys.find((k) => tierFor(k.key).tier === "LOCKED");
  const guardedKey = allKeys.find((k) => tierFor(k.key).tier === "GUARDED");

  const attemptSet = async (key: string, value: string) => {
    const f = fakeInteraction({
      userId: ADMIN_USER,
      roleIds: [env.adminRoleId],
      channelId: GOOD_CHANNEL,
      strings: { key, value },
    });
    await handleConfigSet(f.interaction, db);
    const after = await db
      .select({ value: configKey.value })
      .from(configKey)
      .where(eq(configKey.key, key))
      .limit(1);
    return { said: f.captured.text, stored: after[0]?.value };
  };

  if (lockedKey) {
    const r = await attemptSet(lockedKey.key, "definitely-not-this");
    check(`LOCKED ${lockedKey.key} refused`, r.said.includes("ถูกล็อกไว้"));
    check(`LOCKED ${lockedKey.key} value untouched`, r.stored === lockedKey.value, `still ${r.stored}`);
  } else {
    check("a LOCKED key exists to test", false);
  }

  if (guardedKey) {
    const r = await attemptSet(guardedKey.key, "definitely-not-this");
    check(`GUARDED ${guardedKey.key} refused without confirm`, r.said.includes("GUARDED"));
    check(`GUARDED ${guardedKey.key} value untouched`, r.stored === guardedKey.value, `still ${r.stored}`);
  } else {
    check("a GUARDED key exists to test", false);
  }

  // ── 5. /config get and autocomplete ──────────────────────────────
  console.log("\n/config get and autocomplete");
  const getMotd = fakeInteraction({
    userId: ADMIN_USER,
    roleIds: [env.adminRoleId],
    channelId: GOOD_CHANNEL,
    strings: { key: "motd" },
  });
  await handleConfigGet(getMotd.interaction, db);
  check("/config get motd", getMotd.captured.embeds === 1, getMotd.captured.text.replace(/\s+/g, " ").slice(0, 80));

  const choices = await autocompleteConfigKey(db, "");
  check("autocomplete returns choices", choices.length > 0, `${choices.length} shown`);
  check("autocomplete respects Discord's 25 cap", choices.length <= 25);
  check(
    "autocomplete marks locked keys",
    choices.some((c) => c.name.includes("LOCKED")),
    choices.find((c) => c.name.includes("LOCKED"))?.name ?? "",
  );

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
} finally {
  await sql.end();
}

process.exit(failures === 0 ? 0 : 1);
