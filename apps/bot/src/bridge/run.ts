/**
 * The Chat Bridge, wired together.
 *
 * One spine: everything that crosses becomes a `chat_message` row, and this
 * process is the only thing that moves rows out of it. The web app writes rows
 * and reads rows and never opens an RCON connection — `max-tick-time=-1` means
 * chunk generation can legitimately block the Game Server's main thread for minutes
 * (README rule 3), and a request handler awaiting RCON would hang the chat box
 * in a way a visitor cannot tell apart from the site being broken.
 *
 * A row's `source` decides what still has to happen to it. A `game` row is
 * already in the game and only needs Discord; a `discord` row is already in
 * Discord and only needs the game. Nothing is ever delivered back to where it
 * came from, so the bridge cannot echo itself.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { Events, type Client, type Message } from "discord.js";

import {
  bridgeChannel,
  chatMessage,
  playerMilestone,
  type Database,
} from "@tapestopnight/core/db";
import { broadcast } from "@tapestopnight/core/control";
import {
  linkCommand,
  recordLoginIp,
  redeemLinkCode,
  sanitizeBody,
  tellrawCommand,
  tellrawNotice,
  expireStaleLinkState,
} from "@tapestopnight/core/bridge";

import { env } from "../env.ts";
import { LogTailer } from "./tailer.ts";
import { scanMilestones } from "./milestones.ts";

/**
 * How long an undelivered message is still worth delivering.
 *
 * The Game Server is regularly unreachable for minutes at a time and that is
 * normal here, so a failed send is retried rather than dropped. But a server
 * that has been down for an hour must not come back to an hour of accumulated
 * conversation arriving at once, out of context and addressed to people who
 * have long since logged off.
 */
const DELIVERY_WINDOW_MS = 10 * 60 * 1000;

/** Never move more than this per tick, so one backlog cannot monopolise RCON. */
const BATCH = 20;

function log(...parts: unknown[]) {
  console.log(new Date().toISOString(), "[bridge]", ...parts);
}

async function channelsOfKind(db: Database, kind: "chat" | "milestone"): Promise<string[]> {
  const rows = await db
    .select({ channelId: bridgeChannel.channelId })
    .from(bridgeChannel)
    .where(and(eq(bridgeChannel.kind, kind), eq(bridgeChannel.enabled, true)));
  return rows.map((r) => r.channelId);
}

/**
 * Post to every channel configured for a purpose.
 *
 * Fails closed like `allowed_channel`: with no rows nothing is mirrored
 * anywhere, which is the safe reading of "nobody has said where this belongs".
 */
async function post(client: Client, channelIds: string[], content: string): Promise<void> {
  for (const id of channelIds) {
    try {
      const channel = await client.channels.fetch(id);
      if (channel?.isTextBased() && "send" in channel) {
        // `allowedMentions: { parse: [] }` is the trust boundary in this
        // direction. Anything a player types in game is relayed verbatim, and
        // without this an `@everyone` in the chat box would ping the guild.
        await channel.send({ content, allowedMentions: { parse: [] } });
      }
    } catch (err) {
      log(`could not post to ${id}:`, err instanceof Error ? err.message : err);
    }
  }
}

export function startBridge(client: Client, db: Database): () => void {
  const rcon = env.rcon;

  // ── game → us ───────────────────────────────────────────────────────────
  const tailer = new LogTailer({
    path: env.bridge.logPath,
    onError: (message) => log("event failed:", message),
    onEvent: async (event) => {
      if (event.kind === "login") {
        // Evidence for address matching (ADR-0016). Recorded for every login,
        // including players who never open the website, because the match is
        // made later and cannot ask the past for data it did not keep.
        await recordLoginIp(db, { mcName: event.name, ip: event.ip });
        return;
      }

      const code = linkCommand(event.body);
      if (code) {
        // Deliberately NOT relayed. The line contains a live credential, and
        // the exchange is between one player and the server.
        const result = await redeemLinkCode(db, { code, mcName: event.name });
        await broadcast(rcon, tellrawNotice(event.name, linkReply(result))).catch((err) =>
          log("link reply failed:", err instanceof Error ? err.message : err),
        );
        log(`link attempt by ${event.name}: ${result.status}`);
        return;
      }

      const body = sanitizeBody(event.body);
      if (!body) return;
      await db.insert(chatMessage).values({
        source: "game",
        authorName: event.name,
        body,
        deliveredToGame: true, // it started there
      });
    },
  });

  // ── Discord → us ────────────────────────────────────────────────────────
  const onMessage = async (message: Message) => {
    if (message.author.bot || !message.inGuild()) return;

    const allowed = await channelsOfKind(db, "chat");
    if (!allowed.includes(message.channelId)) return;

    const body = sanitizeBody(message.content);
    if (!body) return;

    await db.insert(chatMessage).values({
      source: "discord",
      authorName: message.member?.displayName ?? message.author.username,
      authorDiscordId: message.author.id,
      body,
      deliveredToDiscord: true, // it started there
    });
  };
  client.on(Events.MessageCreate, (message) => {
    void onMessage(message).catch((err) =>
      log("discord message failed:", err instanceof Error ? err.message : err),
    );
  });

  // ── us → game, us → Discord ─────────────────────────────────────────────
  const markSentToGame = (ids: number[]) =>
    db.update(chatMessage).set({ deliveredToGame: true }).where(inArray(chatMessage.id, ids));

  const markSentToDiscord = (ids: number[]) =>
    db.update(chatMessage).set({ deliveredToDiscord: true }).where(inArray(chatMessage.id, ids));

  async function drainToGame(): Promise<void> {
    const pending = await db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.deliveredToGame, false))
      .orderBy(asc(chatMessage.id))
      .limit(BATCH);
    if (pending.length === 0) return;

    const cutoff = Date.now() - DELIVERY_WINDOW_MS;
    const stale = pending.filter((m) => m.createdAt.getTime() < cutoff);
    const fresh = pending.filter((m) => m.createdAt.getTime() >= cutoff);

    if (stale.length > 0) {
      log(`dropping ${stale.length} message(s) older than the delivery window`);
      await markSentToGame(stale.map((m) => m.id));
    }

    const sent: number[] = [];
    for (const message of fresh) {
      const prefix = message.source === "web" ? "เว็บ" : "ดิสคอร์ด";
      try {
        await broadcast(rcon, tellrawCommand(prefix, message.authorName, message.body));
        sent.push(message.id);
      } catch (err) {
        // Left undelivered on purpose: the Game Server being unreachable is a
        // normal, temporary state here, not a reason to lose what someone said.
        log("rcon send failed, will retry:", err instanceof Error ? err.message : err);
        break;
      }
    }
    if (sent.length > 0) await markSentToGame(sent);
  }

  async function drainToDiscord(): Promise<void> {
    const pending = await db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.deliveredToDiscord, false))
      .orderBy(asc(chatMessage.id))
      .limit(BATCH);
    if (pending.length === 0) return;

    const channels = await channelsOfKind(db, "chat");
    // Marked delivered even with nowhere to send. Otherwise an unconfigured
    // bridge accumulates every line ever said and dumps the lot the moment
    // someone adds a channel row.
    if (channels.length > 0) {
      for (const message of pending) {
        const where = message.source === "web" ? " *(เว็บ)*" : "";
        await post(client, channels, `**${message.authorName}**${where}: ${message.body}`);
      }
    }
    await markSentToDiscord(pending.map((m) => m.id));
  }


  // ── milestones ──────────────────────────────────────────────────────────
  async function announceMilestones(): Promise<void> {
    const found = await scanMilestones(db, env.bridge.worldDir, env.packDir, rcon);
    if (found.length === 0) return;

    /*
      Cold start, PER PLAYER — not per table.

      Both files carry a player's whole history, so the first time this sees
      someone it is looking at everything they have ever done, not at what they
      just did. That backlog is recorded silently; announcing it would open by
      congratulating them for months of past play.

      Deciding this from "is the table empty" instead would be wrong in both
      directions on this server: the first ever notable event would be swallowed
      because no rows existed yet, and thereafter every NEW player's entire
      back-catalogue would fire at once because rows did exist. The question is
      "have I seen this player before", and only a per-player answer answers it.
    */
    const known = new Set(
      (await db.selectDistinct({ mcName: playerMilestone.mcName }).from(playerMilestone)).map(
        (r) => r.mcName,
      ),
    );

    let backfilled = 0;
    for (const event of found) {
      const [inserted] = await db
        .insert(playerMilestone)
        .values({ mcName: event.mcName, kind: event.kind, key: event.key, detail: event.label })
        .onConflictDoNothing()
        .returning({ mcName: playerMilestone.mcName });
      if (!inserted) continue;

      // `known` is deliberately not updated inside the loop: everything found
      // for a first-seen player in THIS scan is backlog, including the rest of
      // their events. From the next scan on they are known and announced.
      if (!known.has(event.mcName)) {
        backfilled++;
        continue;
      }

      await post(
        client,
        await channelsOfKind(db, "milestone"),
        `🏆 **${event.mcName}** ${event.label}`,
      );
    }
    if (backfilled > 0) {
      log(`recorded ${backfilled} existing milestone(s) for first-seen player(s) without announcing`);
    }
  }

  // ── the two clocks ──────────────────────────────────────────────────────
  let stopped = false;
  const loop = async (name: string, everyMs: number, body: () => Promise<void>) => {
    while (!stopped) {
      try {
        await body();
      } catch (err) {
        // Never exit. If this loop dies the bridge goes quiet with the bot
        // still online and answering commands, which reads as "chat is broken"
        // with nothing anywhere saying why.
        log(`${name} failed:`, err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, everyMs));
    }
  };

  void loop("chat", env.bridge.pollMs, async () => {
    await tailer.tick();
    await drainToGame();
    await drainToDiscord();
  });
  void loop("milestones", env.bridge.scanMs, async () => {
    await expireStaleLinkState(db);
    await announceMilestones();
  });

  log(`started — log=${env.bridge.logPath} world=${env.bridge.worldDir}`);
  return () => {
    stopped = true;
  };
}

/** What the player is told in game. Every branch says what to do next. */
function linkReply(result: { status: string; mcName?: string }): string {
  switch (result.status) {
    case "linked":
      return "ผูกบัญชี Discord เรียบร้อย — คุยผ่านเว็บได้แล้ว";
    case "already":
      return "บัญชีนี้ผูกไว้อยู่แล้ว";
    case "taken":
      return "ชื่อนี้ถูกผูกกับบัญชี Discord อื่นไปแล้ว — ทักแอดมินถ้าคิดว่าผิด";
    case "bad-code":
      return "โค้ดไม่ถูกต้องหรือหมดอายุแล้ว — ขอโค้ดใหม่จากหน้าเว็บ";
    default:
      return "ผูกบัญชีไม่สำเร็จ — ขอโค้ดใหม่จากหน้าเว็บ";
  }
}
