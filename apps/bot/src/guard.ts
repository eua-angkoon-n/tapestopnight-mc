import { eq } from "drizzle-orm";
import type { ChatInputCommandInteraction } from "discord.js";

import { allowedChannel, type Database } from "@tapestopnight/core/db";
import { authorizeAdmin, type AdminGrant } from "@tapestopnight/core/auth";

import { env } from "./env.ts";

/**
 * The two questions asked before any command does anything: is this channel
 * allowed, and is this person an admin.
 *
 * Neither is answered by Discord's own permission UI, and neither is answered
 * by whether the command was visible. Visibility is a hint; this is the
 * boundary. Same principle the web app follows - /config renders a real 403
 * server-side whether or not the nav link was drawn.
 */

/**
 * Role ids for the caller.
 *
 * An interaction already carries them, so unlike the web app the bot never
 * calls the Discord API to find out - which is also why it needs no privileged
 * intent. The shape differs depending on whether discord.js resolved a full
 * GuildMember or left the raw API object, and both appear in practice.
 */
export function roleIdsOf(interaction: ChatInputCommandInteraction): string[] {
  const member = interaction.member;
  if (!member) return [];
  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) return roles as string[];
  const cache = (roles as { cache?: Map<string, unknown> } | undefined)?.cache;
  if (cache) return [...cache.keys()];
  return [];
}

/**
 * Requirement 3.3 — the bot answers only in channels someone has allowed.
 *
 * Fails CLOSED when the table is empty. An empty allowlist means "nobody has
 * said where this bot may operate", and the safe reading of that is nowhere.
 * The refusal carries the exact SQL to fix it, because there is deliberately
 * no UI for this table and a fail-closed door with no visible handle is how
 * you get someone editing the database at random.
 */
export async function channelAllowed(
  db: Database,
  channelId: string,
): Promise<{ allowed: boolean; anyConfigured: boolean }> {
  const rows = await db
    .select({ channelId: allowedChannel.channelId, enabled: allowedChannel.enabled })
    .from(allowedChannel);

  const enabled = rows.filter((r) => r.enabled);
  return {
    allowed: enabled.some((r) => r.channelId === channelId),
    anyConfigured: enabled.length > 0,
  };
}

export function channelRefusalMessage(channelId: string, anyConfigured: boolean): string {
  if (anyConfigured) {
    return "บอทไม่ตอบในห้องนี้ — ใช้คำสั่งในห้องที่กำหนดไว้";
  }
  return [
    "ยังไม่ได้กำหนดห้องที่บอทตอบได้เลย จึงไม่ตอบที่ไหนทั้งนั้น (fail closed)",
    "",
    "อนุญาตห้องนี้ด้วยคำสั่งนี้บนเครื่อง:",
    "```sql",
    `INSERT INTO allowed_channel (channel_id, note) VALUES ('${channelId}', 'ห้องหลัก');`,
    "```",
  ].join("\n");
}

/** ADR-0004, asked through core so the bot and the web can never disagree. */
export async function adminGrantFor(
  db: Database,
  interaction: ChatInputCommandInteraction,
): Promise<AdminGrant> {
  return authorizeAdmin(db, {
    discordId: interaction.user.id,
    roleIds: roleIdsOf(interaction),
    adminRoleId: env.adminRoleId,
  });
}

export const ADMIN_REFUSAL =
  "คำสั่งนี้สำหรับแอดมินเท่านั้น — สิทธิ์มาจาก role ใน Discord (ADR-0004) " +
  "ถ้าคิดว่าควรมีสิทธิ์ ให้คนที่ดูแล guild กำหนด role ให้";
