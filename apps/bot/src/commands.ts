import {
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
 * that powered off a home PC; the equivalent here would take an unrelated
 * system on the same machine offline with it.
 *
 * ── What the Minecraft tree had and this does not ────────────────────
 *
 * `/config get|set|apply` is gone. It was built around `server.properties` —
 * one flat file of typed keys with a tier table deciding which were safe to
 * edit from Discord. Project Zomboid's settings are split across an INI and a
 * 1000-line `SandboxVars.lua`, and the two keys people would most want to
 * change, `Mods=` and `WorkshopItems=`, are REWRITTEN by the container's
 * entrypoint from `docker-compose.yml` on every start — so a bot that edited
 * them would be silently overwritten. Re-adding it means designing for that,
 * not porting the old one.
 *
 * `/info modpack|download|icon` is gone with the modpack it described.
 * `/info setup` replaces it with the thing that actually blocks a player here.
 */

/**
 * Which subcommands require an admin (ADR-0004), keyed "group subcommand".
 *
 * A table rather than a check scattered through the handlers, so the answer to
 * "what can a non-admin do?" is one screen you can read, and adding a
 * subcommand without deciding its tier is visible in review.
 *
 * `/server status`, `/players list` and everything under `/info` are readable
 * by anyone in an allowed channel — they expose only what someone who can
 * already connect would see.
 *
 * `start`, `stop` and `restart` are admin because they disconnect everyone
 * currently playing.
 */
export const ADMIN_ONLY: ReadonlySet<string> = new Set([
  "server start",
  "server stop",
  "server restart",
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
    .addSubcommand((s) => s.setName("setup").setDescription("ต้องลงอะไรบ้างก่อนเข้าเซิร์ฟ"))
    .addSubcommand((s) => s.setName("ip").setDescription("ที่อยู่ที่ใช้เข้าเซิร์ฟเวอร์"));

  return [server, players, info].map((c) => c.toJSON());
}

/**
 * Publish the tree to the guild, replacing whatever was registered before.
 *
 * Guild-scoped, not global: guild commands appear immediately, global ones can
 * take up to an hour, and this bot serves exactly one guild.
 *
 * The PUT is a wholesale replacement, which is also the migration: the
 * Minecraft tree's `/config` and `/info modpack` disappear by being absent from
 * this list rather than by being deleted one at a time.
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
