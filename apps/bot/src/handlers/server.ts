import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";

import { DOWN, OK, WARN } from "@tapestopnight/core/brand";
import { announceRestart, inspect, listPlayers, restart, start, stop } from "@tapestopnight/core/control";

import { env } from "../env.ts";

/**
 * /server — status and lifecycle for the Project Zomboid server.
 *
 * Two rules shape everything here, both from the server rather than from taste:
 *
 * 1. Saving the world is what `stop` is FOR. The entrypoint turns SIGTERM into
 *    a `quit` on the server console and waits; cutting that short is how a
 *    world is lost. Every stop here is graceful and timed to the container's
 *    `stop_grace_period`.
 * 2. A first boot after a mod change is SLOW and looks hung. Workshop items
 *    download on one start and activate on the next, so "no answer yet" is a
 *    normal multi-minute state, not a fault.
 */

/**
 * Status, assembled live from the container and RCON.
 *
 * The Minecraft version of this read a cache row the Status Poller refreshed,
 * because every `/server status` would otherwise have cost the Game Server a
 * Server List Ping. **PZ has no Server List Ping**, so there was never a cheap
 * probe for a poller to run, and the poller has no counterpart here.
 *
 * What replaces it costs the server almost nothing: `inspect` talks to the
 * socket-proxy on the Host and never touches the game, and the player list is
 * one short RCON round trip — measured at ~300 ms against the live server.
 * For a server capped at 8 players that is cheaper than maintaining a cache
 * that can be stale.
 */
export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const state = await inspect(env.docker).catch(() => null);

  if (!state) {
    await interaction.editReply(
      "ถามสถานะคอนเทนเนอร์ไม่สำเร็จ — socket-proxy อาจไม่ทำงาน",
    );
    return;
  }

  if (!state.running) {
    const embed = new EmbedBuilder()
      .setColor(DOWN)
      .setTitle("🔴 เซิร์ฟเวอร์ปิดอยู่")
      .addFields(
        { name: "คอนเทนเนอร์", value: state.status, inline: true },
        { name: "exit code", value: String(state.exitCode ?? "—"), inline: true },
      );

    // Surfaced loudly rather than left to look like an unexplained crash: the
    // JVM runs close enough to the cgroup ceiling that an OOM kill is the
    // failure mode to expect first (ADR-0012).
    if (state.oomKilled) {
      embed.addFields({
        name: "⚠ OOM",
        value:
          "คอนเทนเนอร์ถูก kernel ฆ่าเพราะใช้ RAM เกินเพดาน — " +
          "ตรวจ `memory.events` และ `/proc/<pid>/status` ก่อนเปิดใหม่",
      });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  /*
    Running, so ask who is on. A failure here is NOT "the server is down" — the
    container is demonstrably up, and RCON not answering during a long boot or a
    mod load is normal. Reported as unknown rather than as an outage.
  */
  let players: string[] | null = null;
  let rconError: string | null = null;
  try {
    players = await listPlayers(env.rcon);
  } catch (err) {
    rconError = err instanceof Error ? err.message : String(err);
  }

  const embed = new EmbedBuilder()
    .setColor(players ? OK : WARN)
    .setTitle(players ? "🟢 เซิร์ฟเวอร์ออนไลน์" : "🟡 คอนเทนเนอร์ทำงานอยู่ แต่ยังไม่ตอบ")
    .addFields(
      {
        name: "ที่อยู่",
        value: `\`${env.serverAddress}:${env.serverPort}\``,
        inline: true,
      },
      {
        name: "ผู้เล่น",
        value: players ? `${players.length}` : "ยังไม่ทราบ",
        inline: true,
      },
      { name: "คอนเทนเนอร์", value: state.status, inline: true },
    );

  if (players && players.length > 0) {
    embed.addFields({ name: "ออนไลน์อยู่", value: players.join(", ") });
  }

  if (rconError) {
    embed.addFields({
      name: "RCON",
      value:
        `ยังไม่ตอบ (${rconError})\n` +
        "ถ้าเพิ่งเปิดหรือเพิ่งเพิ่มม็อด อาการนี้ปกติ — ม็อดจะโหลดรอบแรกและติดจริงรอบสอง",
    });
  }

  if (state.startedAt) {
    embed.setFooter({ text: `เปิดมาตั้งแต่ ${state.startedAt.slice(0, 19).replace("T", " ")} UTC` });
  }

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
    "สั่งเปิดเซิร์ฟเวอร์แล้ว — ใช้เวลาราว **1–2 นาที** กว่าจะเข้าได้ " +
      "ถ้าเพิ่งมีการเพิ่มม็อด รอบแรกจะดาวน์โหลดอย่างเดียวและนานกว่านั้นมาก " +
      "ดูได้เรื่อย ๆ ด้วย `/server status`",
  );
}

/** Shared by stop and restart: warn, wait, then act. */
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
    // Matches stop_grace_period: 3m. Docker SIGKILLs anything still alive when
    // this elapses, and a SIGKILL arriving mid-save is how a world is lost.
    () => stop(env.docker, env.stopTimeoutSeconds),
    "ปิดเซิร์ฟเวอร์เรียบร้อย — เซฟโลกครบก่อนปิดแล้ว",
  );
}

export async function handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
  const skip = interaction.options.getBoolean("now") ?? false;
  await countdownThen(
    interaction,
    skip,
    "รีสตาร์ทเซิร์ฟเวอร์",
    () => restart(env.docker, env.stopTimeoutSeconds),
    "รีสตาร์ทแล้ว — เซิร์ฟเวอร์กำลังบูตขึ้นมาใหม่ อาจใช้เวลา 1–2 นาที ดูด้วย `/server status`",
  );
}
