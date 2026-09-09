import { AttachmentBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { eq } from "drizzle-orm";

import { serverInfo, type Database } from "@tapestopnight/core/db";

import { env } from "../env.ts";

/**
 * /info — requirement 2.3's content, delivered where the players already are.
 *
 * Everything comes from the `server_info` row, the same source the website
 * reads. Hardcoding the modpack version here would create a second place to
 * update it, and the one that gets forgotten is the one people quote at each
 * other when someone cannot join.
 */

const ACCENT = 0xc75b2a;

async function loadInfo(db: Database) {
  const rows = await db.select().from(serverInfo).where(eq(serverInfo.id, 1)).limit(1);
  return rows[0] ?? null;
}

export async function handleInfoModpack(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const info = await loadInfo(db);
  if (!info) {
    await interaction.editReply("ยังไม่มีข้อมูลเซิร์ฟเวอร์ในฐานข้อมูล");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(info.modpackName)
    .addFields(
      { name: "เวอร์ชัน modpack", value: `\`${info.modpackVersion}\``, inline: true },
      { name: "Minecraft", value: `\`${info.minecraftVersion}\``, inline: true },
      { name: "Forge", value: `\`${info.forgeVersion}\``, inline: true },
    )
    .setFooter({
      // The single most common reason someone cannot join, said before they ask.
      text: "เวอร์ชันไม่ตรงกับเซิร์ฟเวอร์คือสาเหตุที่พบบ่อยที่สุดของการเข้าไม่ได้",
    });

  await interaction.editReply({ embeds: [embed] });
}

export async function handleInfoIp(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const info = await loadInfo(db);
  const address = info?.serverAddress ?? env.publicBaseUrl.replace(/^https?:\/\//, "");
  await interaction.editReply(
    `**ที่อยู่เซิร์ฟเวอร์**\n\`\`\`\n${address}\n\`\`\`\n` +
      "ใส่ตรง ๆ ใน Multiplayer → Add Server **ไม่ต้องใส่พอร์ต** " +
      "(SRV record ชี้ให้เอง)",
  );
}

export async function handleInfoDownload(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const info = await loadInfo(db);
  if (!info?.downloadUrl) {
    await interaction.editReply(
      "ยังไม่ได้ตั้งลิงก์ดาวน์โหลด — แอดมินตั้งได้ในหน้าเว็บ",
    );
    return;
  }
  await interaction.editReply(
    `**ดาวน์โหลด ${info.modpackName} ${info.modpackVersion}**\n${info.downloadUrl}`,
  );
}

/**
 * The icon players actually see, attached from the database.
 *
 * Attached rather than linked to the website: this answers "is the icon set
 * correctly" even when the web app is down, and it shows the exact 64x64
 * derivative Minecraft is served rather than the high-resolution original,
 * which is the artifact whose correctness anyone would be checking.
 */
export async function handleInfoIcon(
  interaction: ChatInputCommandInteraction,
  db: Database,
): Promise<void> {
  const rows = await db
    .select({
      icon64: serverInfo.icon64,
      sha: serverInfo.iconSourceSha256,
      updatedAt: serverInfo.iconUpdatedAt,
    })
    .from(serverInfo)
    .where(eq(serverInfo.id, 1))
    .limit(1);

  const row = rows[0];
  if (!row?.icon64) {
    await interaction.editReply(
      "ยังไม่ได้ตั้งไอคอนเซิร์ฟเวอร์ — แอดมินอัปโหลดได้ในหน้าเว็บ แล้วกด Apply",
    );
    return;
  }

  const file = new AttachmentBuilder(Buffer.from(row.icon64), { name: "server-icon.png" });
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("ไอคอนเซิร์ฟเวอร์")
    .setDescription(
      `ขนาด 64×64 ตามที่ Minecraft ต้องการ (${row.icon64.byteLength.toLocaleString()} ไบต์)\n` +
        `ต้นฉบับความละเอียดสูงอยู่ที่ ${env.publicBaseUrl}/api/icon`,
    )
    .setThumbnail("attachment://server-icon.png");

  if (row.updatedAt) {
    embed.setFooter({ text: `อัปเดตเมื่อ ${row.updatedAt.toISOString().slice(0, 16).replace("T", " ")}` });
  }

  await interaction.editReply({ embeds: [embed], files: [file] });
}
