import type { ChatInputCommandInteraction } from "discord.js";

import { inspect, listPlayers } from "@tapestopnight/core/control";

import { env } from "../env.ts";

/**
 * /players list — who is actually on right now.
 *
 * Straight to RCON. The Minecraft version consulted a poller-written cache
 * first so that a down server could be answered without a doomed RCON attempt;
 * **PZ has no Server List Ping**, so no poller exists to fill such a cache and
 * the container's own state is the cheaper pre-check — it reaches the
 * socket-proxy on the Host and never touches the game.
 */
export async function handlePlayersList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const state = await inspect(env.docker).catch(() => null);
  if (state && !state.running) {
    await interaction.editReply("เซิร์ฟเวอร์ปิดอยู่ จึงไม่มีใครออนไลน์");
    return;
  }

  let names: string[];
  try {
    names = await listPlayers(env.rcon);
  } catch (err) {
    // Deliberately NOT reported as "the server is down". The container is up;
    // RCON stays quiet through a long boot and through a mod load, and a mod
    // set this size makes that a normal multi-minute event.
    await interaction.editReply(
      "ถามรายชื่อผู้เล่นไม่สำเร็จ — ถ้าเพิ่งเปิดเซิร์ฟหรือเพิ่งเพิ่มม็อด อาการนี้ปกติ " +
        "ไม่ได้แปลว่าเซิร์ฟล่ม ลองใหม่อีกสักครู่ " +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
    return;
  }

  if (names.length === 0) {
    await interaction.editReply("ตอนนี้ยังไม่มีใครออนไลน์");
    return;
  }

  await interaction.editReply(
    `**ออนไลน์อยู่ ${names.length} คน**\n` + names.map((n) => `• ${n}`).join("\n"),
  );
}
