import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { desc } from "drizzle-orm";

import { serverStatusCache, type Database } from "@tapestopnight/core/db";
import { announceRestart, inspect, restart, start, stop } from "@tapestopnight/core/control";

import { env } from "../env.ts";

/**
 * /server — status and lifecycle.
 *
 * Two rules shape everything here, both from the modpack rather than from
 * taste:
 *
 * 1. `max-tick-time=-1` is mandatory, so a server that fails to answer for
 *    minutes is NORMAL during OTG generation. Nothing here concludes "down"
 *    from a timeout.
 * 2. Saving a large OTG world takes minutes, so every stop is graceful and
 *    generously timed. Killing it is how worlds corrupt.
 */

const OK = 0x4a8f5f;
const WARN = 0xc8912a;
const DOWN = 0x8a3b32;

function ago(then: Date | null): string {
  if (!then) return "ไม่เคยเห็นออนไลน์";
  const secs = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (secs < 60) return "ไม่กี่วินาทีที่แล้ว";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  return `${Math.floor(hours / 24)} วันที่แล้ว`;
}

/**
 * Status, read from the poller's cache row — never by pinging.
 *
 * The Status Poller is the only thing that probes the Game Server. If this
 * pinged directly, a channel full of people running /server status would each
 * cost the server a probe, which is exactly the load pattern the poller exists
 * to prevent.
 */
export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const rows = await db
    .select()
    .from(serverStatusCache)
    .orderBy(desc(serverStatusCache.probedAt))
    .limit(1);
  const s = rows[0];

  if (!s) {
    await interaction.editReply(
      "ยังไม่มีข้อมูลสถานะ — Status Poller อาจยังไม่ได้รัน ลองใหม่อีกสักครู่",
    );
    return;
  }

  const staleMs = Date.now() - s.probedAt.getTime();
  const stale = staleMs > 60_000;

  const embed = new EmbedBuilder()
    .setColor(s.online ? (stale ? WARN : OK) : DOWN)
    .setTitle(s.online ? "🟢 เซิร์ฟเวอร์ออนไลน์" : "🔴 เซิร์ฟเวอร์ปิดอยู่")
    .addFields(
      { name: "ที่อยู่", value: `\`${env.publicBaseUrl.replace(/^https?:\/\//, "")}\``, inline: true },
      {
        name: "ผู้เล่น",
        value: s.online ? `${s.playersOnline ?? 0} / ${s.playersMax ?? 0}` : "—",
        inline: true,
      },
      { name: "คอนเทนเนอร์", value: s.containerState ?? "ไม่ทราบ", inline: true },
    );

  if (s.online && s.sample && s.sample.length > 0) {
    embed.addFields({ name: "ออนไลน์อยู่", value: s.sample.join(", ") });
  }
  if (!s.online) {
    embed.addFields({ name: "เห็นออนไลน์ล่าสุด", value: ago(s.lastSeenOnline) });
  }
  if (s.motd) embed.addFields({ name: "MOTD", value: s.motd });

  // Surfaced rather than hidden: numbers presented as current when the poller
  // has stopped writing are worse than an admission that we do not know.
  embed.setFooter({
    text: stale
      ? `⚠ ข้อมูลเก่า ${Math.round(staleMs / 1000)} วินาที — Status Poller อาจมีปัญหา`
      : `อัปเดตเมื่อ ${Math.round(staleMs / 1000)} วินาทีที่แล้ว`,
  });

  await interaction.editReply({ embeds: [embed] });
}

export async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const state = await inspect(env.docker).catch(() => null);
  if (state?.running) {
    await interaction.editReply("เซิร์ฟเวอร์เปิดอยู่แล้ว");
    return;
  }

  await start(env.docker);
  await interaction.editReply(
    "สั่งเปิดเซิร์ฟเวอร์แล้ว — **บูตครั้งแรกใช้เวลาหลายนาทีและจะดูเหมือนค้าง** " +
      "นั่นคืออาการปกติของ OTG ที่กำลังสร้างภูมิประเทศ ใช้ `/server status` ดูได้เรื่อย ๆ",
  );
}

/** Shared by stop, restart and config apply: warn, wait, then act. */
export async function countdownThen(
  interaction: ChatInputCommandInteraction,
  skip: boolean,
  reason: string,
  action: () => Promise<void>,
  doneMessage: string,
): Promise<void> {
  const seconds = env.restartCountdownSeconds;

  if (!skip && seconds > 0) {
    await interaction.editReply(
      `กำลังนับถอยหลัง ${seconds} วินาที และประกาศในเกมอยู่ — ${reason}`,
    );
    const announced = await announceRestart({
      rcon: env.rcon,
      totalSeconds: seconds,
      reason,
    });
    if (!announced.announced) {
      // Worth saying out loud: players may have got no warning even though the
      // operator asked for one. The full lead time was still waited out —
      // announceRestart honours the clock whether or not the messages landed.
      await interaction.editReply(
        `⚠ ประกาศในเกมล้มเหลว ${announced.failedMarks} ครั้ง (${announced.error}) — ` +
          "ผู้เล่นอาจไม่ได้รับการเตือน แต่รอครบเวลาแล้วและกำลังทำต่อ",
      );
    }
  }

  await action();
  await interaction.editReply(doneMessage);
}

export async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  const skip = interaction.options.getBoolean("now") ?? false;
  await countdownThen(
    interaction,
    skip,
    "ปิดเซิร์ฟเวอร์",
    // 600 s matches stop_grace_period. The image turns SIGTERM into an RCON
    // stop, so this is a graceful save, and a big OTG world genuinely needs
    // the minutes.
    () => stop(env.docker, 600),
    "ปิดเซิร์ฟเวอร์เรียบร้อย — เซฟโลกครบก่อนปิดแล้ว",
  );
}

export async function handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
  const skip = interaction.options.getBoolean("now") ?? false;
  await countdownThen(
    interaction,
    skip,
    "รีสตาร์ทเซิร์ฟเวอร์",
    () => restart(env.docker, 600),
    "รีสตาร์ทแล้ว — เซิร์ฟเวอร์กำลังบูตขึ้นมาใหม่ อาจใช้เวลาสักครู่ ดูด้วย `/server status`",
  );
}
