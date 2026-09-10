/**
 * The Discord bot — Phase 6.
 *
 * Every command passes two gates before it does anything: the channel must be
 * on the allowlist (requirement 3.3) and, for anything that changes the world
 * or kicks players, the caller must be an admin by ADR-0004. Both are checked
 * HERE, on invocation, not by whether Discord chose to render the command.
 *
 * Authorisation is `authorizeAdmin` from core — the same function the web app
 * calls. That is the entire point of ADR-0006: two implementations of "who is
 * an admin" would drift, and the bug that produces is "the web says I am an
 * admin but the bot disagrees".
 */
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";

import { createDb } from "@tapestopnight/core/db";

import { ADMIN_ONLY, registerCommands } from "./commands.ts";
import { env } from "./env.ts";
import { ADMIN_REFUSAL, adminGrantFor, channelAllowed, channelRefusalMessage } from "./guard.ts";
import {
  autocompleteConfigKey,
  handleConfigApply,
  handleConfigGet,
  handleConfigSet,
} from "./handlers/config.ts";
import {
  handleInfoDownload,
  handleInfoIcon,
  handleInfoIp,
  handleInfoModpack,
} from "./handlers/info.ts";
import { handlePlayersList } from "./handlers/players.ts";
import { startBridge } from "./bridge/run.ts";
import { handleRestart, handleStart, handleStatus, handleStop } from "./handlers/server.ts";

const { db, sql } = createDb();

function log(...parts: unknown[]) {
  console.log(new Date().toISOString(), ...parts);
}

/**
 * Guilds for the command tree, and GuildMessages + MessageContent for the Chat
 * Bridge.
 *
 * The command tree needs neither of the last two — an interaction already
 * carries the caller's roles. The bridge does: relaying what someone typed in a
 * Discord channel into the game is not possible without being allowed to read
 * what they typed, and MessageContent is a PRIVILEGED intent that has to be
 * switched on in the Discord Developer Portal before the gateway will accept
 * this connection at all.
 *
 * ⚠ ADR-0008: this application is shared with DISCO NIGHT and its token is
 * still the one that was meant to be rotated. Turning on MessageContent widens
 * what that application can read across every channel it is in, so rotate the
 * token first rather than after.
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function route(
  interaction: ChatInputCommandInteraction,
  route: string,
): Promise<void> {
  switch (route) {
    case "server status":
      return handleStatus(interaction, db);
    case "server start":
      return handleStart(interaction);
    case "server stop":
      return handleStop(interaction);
    case "server restart":
      return handleRestart(interaction);

    case "players list":
      return handlePlayersList(interaction, db);

    case "info modpack":
      return handleInfoModpack(interaction, db);
    case "info ip":
      return handleInfoIp(interaction, db);
    case "info download":
      return handleInfoDownload(interaction, db);
    case "info icon":
      return handleInfoIcon(interaction, db);

    case "config get":
      return handleConfigGet(interaction, db);
    case "config set":
      return handleConfigSet(interaction, db);
    case "config apply":
      return handleConfigApply(interaction, db);

    default:
      await interaction.editReply(`ไม่รู้จักคำสั่ง \`${route}\``);
  }
}

async function onCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const key = `${interaction.commandName} ${interaction.options.getSubcommand(false) ?? ""}`.trim();

  // Guild-only. A DM has no channel allowlist to check against and no member
  // object to read roles from, so there is nothing to authorise against.
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "บอทนี้ทำงานเฉพาะในเซิร์ฟเวอร์ Discord ไม่ตอบใน DM",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = await channelAllowed(db, interaction.channelId);
  if (!channel.allowed) {
    log(`refused ${key} from ${interaction.user.id}: channel ${interaction.channelId}`);
    await interaction.reply({
      content: channelRefusalMessage(interaction.channelId, channel.anyConfigured),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (ADMIN_ONLY.has(key)) {
    const grant = await adminGrantFor(db, interaction);
    if (!grant.isAdmin) {
      log(`refused ${key} from ${interaction.user.id}: not an admin`);
      await interaction.reply({ content: ADMIN_REFUSAL, flags: MessageFlags.Ephemeral });
      return;
    }
    if (grant.via === "break-glass") {
      // Worth saying every time. Break-glass appearing during normal operation
      // means the Discord role setup is broken, and silence would let that
      // become the permanent state of things.
      log(`!! ${interaction.user.id} used BREAK-GLASS for ${key} — check the guild role setup`);
    }
  }

  /*
    Deferred before any work. A restart countdown runs for 30 seconds and an
    OTG-era stop can take minutes; Discord kills an interaction that is not
    acknowledged within 3 seconds, and a deferred one lives for 15 minutes.

    Admin output is ephemeral: config values and failure detail are for the
    operator, not for the channel.
  */
  const ephemeral = ADMIN_ONLY.has(key);
  await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});

  try {
    await route(interaction, key);
    log(`ok ${key} by ${interaction.user.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`FAILED ${key} by ${interaction.user.id}: ${message}`);
    await interaction
      .editReply(`ทำคำสั่งไม่สำเร็จ: ${message}`)
      .catch(() => log("could not deliver the failure message"));
  }
}

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (interaction.isAutocomplete()) {
    // Autocomplete leaks nothing an allowed member cannot already read with
    // /config get, and Discord gives it a 3 second budget with no defer, so it
    // deliberately does not re-run the channel check.
    try {
      const focused = interaction.options.getFocused();
      await interaction.respond(await autocompleteConfigKey(db, focused));
    } catch (err) {
      log("autocomplete failed:", err instanceof Error ? err.message : err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  await onCommand(interaction);
});

let stopBridge: (() => void) | null = null;

client.once(Events.ClientReady, (ready) => {
  log(`connected as ${ready.user.tag}`);
  // Started here rather than before login: the bridge posts to Discord, and a
  // channel fetch before the gateway is ready fails in a way that looks like a
  // misconfigured channel id rather than a race.
  stopBridge = startBridge(client, db);
});

/*
  ADR-0008: this token previously belonged to DISCO NIGHT, and Discord permits
  exactly ONE active gateway session per token. If DISCO NIGHT is still
  running, the two will knock each other offline in a loop — and because the
  web app's admin check reads guild roles through this application, an unstable
  gateway breaks web login too. That failure looks like a mystery, so it is
  named here.
*/
log("registering commands…");
const registered = await registerCommands(env.token, env.clientId, env.guildId);
log(
  `registered ${registered.guild} guild commands` +
    (registered.globalsCleared
      ? `; cleared ${registered.globalsCleared} stale GLOBAL commands (ADR-0008)`
      : ""),
);

await client.login(env.token);

/*
  Do not die because the Game Server restarted.

  Observed in production: an Apply restarts the Game Server, an in-flight RCON
  call is cut off, and minecraft-server-util's TCPClient rejects a promise from
  its socket close handler that nobody is awaiting any more — the call site had
  already caught the first rejection. Node makes an unhandled rejection fatal by
  default, so the whole bot exited:

    Error: Socket closed unexpectedly while waiting for data
      at closeHandler (minecraft-server-util/dist/structure/TCPClient.js:418)

  `restart: unless-stopped` brought it back in seconds, which hid how much that
  costs: the tailer starts at the END of the log, on purpose, so everything said
  in the gap is gone. A Game Server restart is a NORMAL event here — Apply
  performs one — and losing chat every time one happens is not acceptable.

  Logged loudly rather than swallowed. This exists for third-party async
  fallout, not to make our own bugs quiet, and the log line is how anyone would
  ever find out it fired.
*/
process.on("unhandledRejection", (reason) => {
  log("!! unhandled rejection (staying up):", reason instanceof Error ? reason.stack : reason);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`${signal} — shutting down`);
    stopBridge?.();
    void client.destroy().then(() => sql.end());
  });
}
