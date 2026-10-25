import {
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

/**
 * The command tree.
 *
 * Subcommand groups so that typing `/server` opens Discord's native
 * autocomplete rather than making anyone remember four separate command names.
 *
 * There is deliberately NO command that can stop, reboot or shut down the
 * Host. Only the container. The prior art this replaces had a `pc_shutdown`
 * that powered off a home PC; the equivalent here would take the unrelated
 * ledger system offline with it.
 */

/**
 * Which subcommands require an admin (ADR-0004), keyed "group subcommand".
 *
 * A table rather than a check scattered through the handlers, so the answer to
 * "what can a non-admin do?" is one screen you can read, and adding a
 * subcommand without deciding its tier is visible in review.
 *
 * `/server status`, `/players list` and everything under `/info` are readable
 * by anyone in an allowed channel — they expose what a server list ping
 * already tells the whole internet.
 *
 * `start`, `stop` and `restart` are admin because they disconnect everyone
 * currently playing. The plan named only `/config` as admin-only; extending it
 * to the lifecycle commands is a judgement call, and the alternative — anyone
 * in the channel being able to stop the server mid-session — is not one worth
 * shipping.
 */
export const ADMIN_ONLY: ReadonlySet<string> = new Set([
  "server start",
  "server stop",
  "server restart",
  "config get",
  "config set",
  "config apply",
]);

export function buildCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const server = new SlashCommandBuilder()
    .setName("server")
    .setDescription("ดูสถานะและควบคุมเซิร์ฟเวอร์")
    .addSubcommand((s) => s.setName("status").setDescription("เซิร์ฟเวอร์ออนไลน์อยู่ไหม ใครเล่นอยู่"))
    .addSubcommand((s) => s.setName("start").setDescription("เปิดเซิร์ฟเวอร์ (แอดมิน)"))
    .addSubcommand((s) =>
      s
        .setName("stop")
        .setDescription("ปิดเซิร์ฟเวอร์ พร้อมนับถอยหลังเตือนผู้เล่น (แอดมิน)")
        .addBooleanOption((o) =>
          o
            .setName("now")
            .setDescription("ข้ามการนับถอยหลัง — ใช้เมื่อจำเป็นจริง ๆ เท่านั้น")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("restart")
        .setDescription("รีสตาร์ทเซิร์ฟเวอร์ พร้อมนับถอยหลังเตือนผู้เล่น (แอดมิน)")
        .addBooleanOption((o) =>
          o
            .setName("now")
            .setDescription("ข้ามการนับถอยหลัง — ใช้เมื่อจำเป็นจริง ๆ เท่านั้น")
            .setRequired(false),
        ),
    );

  const players = new SlashCommandBuilder()
    .setName("players")
    .setDescription("ผู้เล่นในเซิร์ฟเวอร์")
    .addSubcommand((s) => s.setName("list").setDescription("รายชื่อคนที่ออนไลน์อยู่ตอนนี้"));

  const info = new SlashCommandBuilder()
    .setName("info")
    .setDescription("ข้อมูลเซิร์ฟเวอร์สำหรับผู้เล่น")
    .addSubcommand((s) => s.setName("modpack").setDescription("modpack และเวอร์ชันที่ต้องใช้"))
    .addSubcommand((s) => s.setName("ip").setDescription("ที่อยู่ที่ใช้เข้าเซิร์ฟเวอร์"))
    .addSubcommand((s) => s.setName("download").setDescription("ลิงก์ดาวน์โหลด modpack"))
    .addSubcommand((s) => s.setName("icon").setDescription("ไอคอนเซิร์ฟเวอร์"));

  const config = new SlashCommandBuilder()
    .setName("config")
    .setDescription("ตั้งค่าเซิร์ฟเวอร์ (แอดมิน)")
    // A visibility hint, NOT the security boundary. Discord cannot express
    // "only holders of DISCORD_ADMIN_ROLE_ID", so this hides the group from
    // ordinary members and every invocation is re-checked against ADR-0004
    // server-side regardless of what Discord decided to show.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("get")
        .setDescription("ดูค่าปัจจุบันของคีย์หนึ่ง")
        .addStringOption((o) =>
          o.setName("key").setDescription("เช่น motd").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("แก้ค่า — ยังไม่มีผลจนกว่าจะ /config apply")
        .addStringOption((o) =>
          o.setName("key").setDescription("คีย์ที่จะแก้").setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) => o.setName("value").setDescription("ค่าใหม่").setRequired(true))
        .addBooleanOption((o) =>
          o
            .setName("confirm")
            .setDescription("จำเป็นสำหรับคีย์ระดับ GUARDED")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("apply")
        .setDescription("เขียนไฟล์และรีสตาร์ทเซิร์ฟ — ผู้เล่นจะหลุด")
        .addBooleanOption((o) =>
          o
            .setName("now")
            .setDescription("ข้ามการนับถอยหลัง — ใช้เมื่อจำเป็นจริง ๆ เท่านั้น")
            .setRequired(false),
        ),
    );

  return [server, players, info, config].map((c) => c.toJSON());
}

/**
 * Publish the tree to the guild, replacing whatever was registered before.
 *
 * Guild-scoped, not global: guild commands appear immediately, global ones can
 * take up to an hour, and this bot serves exactly one guild.
 *
 * The PUT is a wholesale replacement, which is how ADR-0008's migration
 * requirement is met — DISCO NIGHT's stale commands are removed by being
 * absent from the new list rather than by being deleted one at a time.
 */
export async function registerCommands(
  token: string,
  clientId: string,
  guildId: string,
): Promise<{ guild: number; globalsCleared: number }> {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = buildCommands();

  const registered = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body,
  })) as unknown[];

  /*
    Also clear GLOBAL commands. This application previously ran DISCO NIGHT
    (ADR-0008) and any global commands it registered would keep appearing in
    every guild the application is in, including this one, alongside ours.
    This system is deliberately guild-scoped, so the correct global list is
    empty. Idempotent: after the first boot it removes nothing.
  */
  const existingGlobals = (await rest.get(Routes.applicationCommands(clientId))) as unknown[];
  if (existingGlobals.length > 0) {
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
  }

  return { guild: registered.length, globalsCleared: existingGlobals.length };
}
