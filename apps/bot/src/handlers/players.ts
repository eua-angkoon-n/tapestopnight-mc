import { eq } from "drizzle-orm";
import type { ChatInputCommandInteraction } from "discord.js";

import { serverStatusCache, type Database } from "@tapestopnight/core/db";
import { listPlayers } from "@tapestopnight/core/control";

import { env } from "../env.ts";

/**
 * /players list — who is actually on right now.
 *
 * This one command DOES reach the Game Server, over RCON, and that is the
 * point. Server List Ping returns only a *sample* of names — capped around
 * twelve and shuffled — so the poller's cache cannot answer "who is on" once
 * the server is busy. `/list` can.
 *
 * The cache is still consulted first: if the poller says the server is down
 * there is nothing to ask, and an RCON attempt would just hang for its full
 * timeout before saying so.
 */
export async function handlePlayersList(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const rows = await db
    .select({ online: serverStatusCache.online, playersMax: serverStatusCache.playersMax })
    .from(serverStatusCache)
    .where(eq(serverStatusCache.id, 1))
    .limit(1);

  if (rows[0] && !rows[0].online) {
    await interaction.editReply("เซิร์ฟเวอร์ปิดอยู่ จึงไม่มีใครออนไลน์");
    return;
  }

  let names: string[];
  try {
    names = await listPlayers(env.rcon);
  } catch (err) {
    // Deliberately NOT reported as "the server is down". A timeout here is
    // indistinguishable from OTG generating chunks, which max-tick-time=-1
    // makes a normal multi-minute event for this modpack.
    await interaction.editReply(
      "ถามรายชื่อผู้เล่นไม่สำเร็จ — อาจเป็นเพราะเซิร์ฟกำลังสร้างภูมิประเทศอยู่ " +
        "ซึ่งเป็นเรื่องปกติของ modpack นี้ ไม่ได้แปลว่าเซิร์ฟล่ม " +
        `ลองใหม่อีกสักครู่ (${err instanceof Error ? err.message : String(err)})`,
    );
    return;
  }

  if (names.length === 0) {
    await interaction.editReply("ตอนนี้ยังไม่มีใครออนไลน์");
    return;
  }

  const max = rows[0]?.playersMax ?? null;
  await interaction.editReply(
    `**ออนไลน์อยู่ ${names.length}${max ? `/${max}` : ""} คน**\n` +
      names.map((n) => `• ${n}`).join("\n"),
  );
}
