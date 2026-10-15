import { EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";

import { ACCENT } from "@tapestopnight/core/brand";

import { env } from "../env.ts";

/**
 * /info — what a player needs before they can join, where they already are.
 *
 * Deliberately NOT read from the database. The Minecraft version pulled the
 * modpack name, version and loader out of `server_info` so the website and the
 * bot could not disagree — but every one of those columns describes a modpack,
 * and this server has no modpack: the Workshop list lives in
 * `docker-compose.yml` on the Host and the entrypoint writes it into the INI on
 * every start. A second copy in Postgres would be a second thing to forget to
 * update, which is the exact failure the original was avoiding.
 */

/**
 * The two things Steam will NOT do for a player.
 *
 * Every other mod on this server is a Workshop subscription the game fetches on
 * join. pz3d is not: it needs the ZombieBuddy Java agent, which is installed by
 * hand from GitHub, and `DoLuaChecksum=true` means a player whose mod set does
 * not match the server's is refused rather than quietly desynced. So the most
 * common reason someone cannot join is answered here, before they ask — the
 * same job /info modpack did for the Minecraft server.
 */
export async function handleInfoSetup(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("สิ่งที่ต้องลงก่อนเข้าเซิร์ฟ")
    .setDescription(
      "ม็อดเกือบทั้งหมดโหลดเองตอนเข้าเกม **ยกเว้น 2 ตัวนี้ที่ต้องลงมือเอง**",
    )
    .addFields(
      {
        name: "1 · ZombieBuddy",
        value:
          "โหลดจาก GitHub releases ของ `zed-0xff/ZombieBuddy` (เวอร์ชัน **2.3.4 ขึ้นไป**)\n" +
          "Windows ใช้ตัว installer ได้เลย · Linux/macOS ทำตามคู่มือใน repo",
      },
      {
        name: "2 · pz3d",
        value:
          "Subscribe ที่ Workshop แล้วเปิดใน Mods — ต้องเป็น **รุ่นเดียวกับเซิร์ฟเวอร์**\n" +
          "คู่มือเต็ม: https://pz3d.dev",
      },
      {
        name: "ทำไมต้องตรงเป๊ะ",
        value:
          "เซิร์ฟเปิด `DoLuaChecksum` ไว้ ถ้าชุดม็อดไม่ตรงกับเซิร์ฟเวอร์จะ **เข้าไม่ได้** " +
          "ซึ่งเป็นสาเหตุที่พบบ่อยที่สุดของการเข้าเซิร์ฟไม่ได้",
      },
      {
        name: "เครื่องต้องแรงแค่ไหน",
        value: "pz3d แนะนำให้กัน RAM ให้เกมอย่างน้อย **6 GB** และยังเป็นรุ่นพัฒนา บั๊กมีได้ปกติ",
      },
    );

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Where the server is.
 *
 * An IP and a port typed in by hand, with no domain and no SRV record to hide
 * the port behind. PZ speaks UDP, so it cannot sit behind Caddy or the
 * Cloudflare proxy, and the server is unlisted so it never appears in the
 * in-game browser — which makes this command the only way most people will
 * find it.
 */
export async function handleInfoIp(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.editReply(
    `**ที่อยู่เซิร์ฟเวอร์**\n\`\`\`\n${env.serverAddress}\n\`\`\`\n` +
      `**พอร์ต** \`${env.serverPort}\`\n\n` +
      "ใส่เองใน **Join → Add Server** — เซิร์ฟไม่ได้ลงรายการสาธารณะ จึงหาในเกมไม่เจอ\n" +
      "รหัสเข้าเซิร์ฟถามแอดมินได้",
  );
}
