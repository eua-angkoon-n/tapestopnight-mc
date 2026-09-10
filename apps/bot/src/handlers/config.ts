import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { eq } from "drizzle-orm";

import { configHistory, configKey, type Database } from "@tapestopnight/core/db";
import { applyDesiredConfig, decodeUnicodeEscapes, tierFor } from "@tapestopnight/core/config";

import { env } from "../env.ts";
import { countdownThen } from "./server.ts";

/**
 * /config — ADR-0002 and ADR-0003, over Discord.
 *
 * The tier rules are read from the same `tierFor` table the web UI reads, and
 * enforced here on the server rather than by what the command offered. ADR-0003
 * is not a UI convention; it is the thing standing between an admin and an
 * orphaned world, and it has to hold identically on every surface or it holds
 * on none.
 */

const ACCENT = 0xc75b2a;
const LOCKED_COLOUR = 0x8a3b32;

export async function handleConfigGet(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const key = interaction.options.getString("key", true);
  const rows = await db
    .select()
    .from(configKey)
    .where(eq(configKey.key, key))
    .limit(1);

  const row = rows[0];
  if (!row) {
    await interaction.editReply(`ไม่พบคีย์ \`${key}\` ในฐานข้อมูล`);
    return;
  }

  const rule = tierFor(key);
  const embed = new EmbedBuilder()
    .setColor(rule.tier === "LOCKED" ? LOCKED_COLOUR : ACCENT)
    .setTitle(`\`${row.key}\``)
    .addFields(
      { name: "ค่าปัจจุบัน", value: row.value ? `\`${row.value}\`` : "_(ว่าง)_" },
      { name: "ระดับการแก้ไข", value: rule.tier, inline: true },
    );

  if (rule.reason) embed.addFields({ name: "เหตุผล", value: rule.reason });
  if (row.updatedBy) {
    embed.setFooter({
      text: `แก้ล่าสุดโดย ${row.updatedBy} เมื่อ ${row.updatedAt.toISOString().slice(0, 16).replace("T", " ")}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

export async function handleConfigSet(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const key = interaction.options.getString("key", true);
  // Accept `§` as well as `§` — same reason as the web panel: every MOTD
  // generator emits the escape form and `§` is on nobody's keyboard.
  const value = decodeUnicodeEscapes(interaction.options.getString("value", true));
  const confirmed = interaction.options.getBoolean("confirm") ?? false;
  const rule = tierFor(key);

  /*
    LOCKED is refused outright. Changing level-name orphans the world and
    loses every player's progress along with the pre-generation; there is no
    confirmation flag that makes that a reasonable thing to do from a chat
    message.
  */
  if (rule.tier === "LOCKED") {
    await interaction.editReply(
      `🔒 คีย์ \`${key}\` ถูกล็อกไว้ แก้ผ่านบอทหรือเว็บไม่ได้\n${rule.reason ?? ""}`,
    );
    return;
  }

  /*
    GUARDED needs a second deliberate act. The web asks the admin to type the
    server address; Discord has no equivalent, so it is an explicit
    `confirm:True` on the command — which is visible in the invocation itself
    and cannot be produced by pressing enter on autocomplete.
  */
  if (rule.tier === "GUARDED" && !confirmed) {
    await interaction.editReply(
      `⚠ \`${key}\` เป็นคีย์ระดับ **GUARDED**\n` +
        `${rule.reason ?? ""}\n\n` +
        `ถ้าแน่ใจ ให้สั่งซ้ำโดยใส่ \`confirm: True\``,
    );
    return;
  }

  const rows = await db
    .select({ value: configKey.value })
    .from(configKey)
    .where(eq(configKey.key, key))
    .limit(1);

  const before = rows[0]?.value;
  if (before === undefined) {
    await interaction.editReply(`ไม่พบคีย์ \`${key}\` ในฐานข้อมูล`);
    return;
  }
  if (before === value) {
    await interaction.editReply("ค่าเดิมอยู่แล้ว ไม่มีอะไรเปลี่ยน");
    return;
  }

  await db
    .update(configKey)
    .set({ value, updatedBy: interaction.user.id, updatedAt: new Date() })
    .where(eq(configKey.key, key));

  // Same append-only trail the web writes to, so history does not depend on
  // which surface someone happened to use.
  await db.insert(configHistory).values({
    key,
    oldValue: before,
    newValue: value,
    changedBy: interaction.user.id,
  });

  await interaction.editReply(
    `บันทึกแล้ว \`${key}\`\n` +
      `\`${before}\` → \`${value}\`\n\n` +
      "ยังไม่มีผลกับผู้เล่นจนกว่าจะสั่ง `/config apply`",
  );
}

export async function handleConfigApply(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const skip = interaction.options.getBoolean("now") ?? false;

  await countdownThen(
    interaction,
    skip,
    "ปรับตั้งค่าเซิร์ฟเวอร์",
    async () => {
      const outcome = await applyDesiredConfig(db, {
        packDir: env.packDir,
        renderedBy: interaction.user.id,
        docker: env.docker,
        // Supplied from the environment, never from a config_key row — a
        // locked key's value is displayed on the admin page (ADR-0003) and
        // this one is a password.
        secrets: { "rcon.password": env.rcon.password },
      });

      // Thrown so countdownThen's success message is not sent over a failure.
      // The message is already written for the operator.
      if (!outcome.ok) {
        throw new Error(
          outcome.failedAt === "precondition"
            ? `Apply ถูกยกเลิกก่อนเขียนไฟล์: ${outcome.error}`
            : outcome.failedAt === "properties"
            ? `เขียน server.properties ไม่สำเร็จ: ${outcome.error} — ไม่ได้รีสตาร์ท`
            : `เขียนไฟล์แล้วแต่รีสตาร์ทไม่สำเร็จ: ${outcome.error} — ` +
              "ค่าใหม่จะมีผลเมื่อรีสตาร์ทครั้งถัดไป",
        );
      }
      if (outcome.iconError) {
        await interaction.followUp({
          content: `⚠ เขียนไอคอนไม่สำเร็จ: ${outcome.iconError} — ส่วนที่เหลือของ Apply สำเร็จ`,
          flags: MessageFlags.Ephemeral,
        });
      }
    },
    "Apply สำเร็จ — เขียนไฟล์และรีสตาร์ทเซิร์ฟแล้ว",
  );
}

/**
 * Autocomplete for the `key` option.
 *
 * Shows the tier next to each key, so the refusal for a LOCKED key is not the
 * first time an admin learns it is locked. ADR-0003 keeps locked keys visible
 * for exactly this reason: someone who cannot see why a key is unavailable
 * goes looking for the file over SSH, which is the failure ADR-0002 forbids.
 */
export async function autocompleteConfigKey(
  db: Database,
  query: string,
): Promise<{ name: string; value: string }[]> {
  const rows = await db.select({ key: configKey.key }).from(configKey).orderBy(configKey.key);
  const needle = query.toLowerCase();

  return rows
    .filter((r) => r.key.toLowerCase().includes(needle))
    .slice(0, 25) // Discord's hard cap on choices.
    .map((r) => {
      const tier = tierFor(r.key).tier;
      const mark = tier === "LOCKED" ? "🔒" : tier === "GUARDED" ? "⚠" : "";
      return { name: `${mark} ${r.key} · ${tier}`.trim(), value: r.key };
    });
}
