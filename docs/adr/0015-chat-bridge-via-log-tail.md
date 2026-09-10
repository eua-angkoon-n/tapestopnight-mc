# The Chat Bridge reads the log file and writes over RCON — and milestones come from Better Questing, not advancements

Three requests arrived together: announce big achievements in Discord, let people
chat with the game from the website, and mirror in-game chat into a Discord
channel. They are one system — a bridge between the Game Server and everything
else — so they are one decision.

Two of the obvious ways to build it are wrong here for reasons that are only
visible on this pack, and one of them was wrong for a reason nobody would guess.

## Advancements do not exist on this pack

The plan for "announce big achievements" was to set `announceAdvancements` and
read `X has made the advancement [Y]` out of the log. That gamerule **is**
already `true` in `config/globalgamerules.cfg`, and it announces nothing,
because `config/fermiummixins.cfg` ships:

```
# Nukes the Advancement system from loading, save a large amount of memory
B:"Nuke Advancements (Vanilla)"=true
```

Confirmed on the Host rather than assumed: after a real play session,
`DregoraRL/advancements/<uuid>.json` is `{}` — not "few entries", empty. A
design waiting for those log lines waits forever, and would have looked like a
parser bug rather than a missing feature.

Turning the mixin off was considered and rejected. It is on to save memory, and
ADR-0012 already runs a 7 GB heap measured at 8.0–8.5 GiB RSS against a 10 GB
cgroup on a 12 GB Host; buying announcements with heap headroom is trading the
thing that keeps the server up for a nicety. It would also need a restart and a
`check-drift.sh --accept`, to reach a system this pack does not use anyway.

**What Dregora actually uses is Better Questing** — `DregoraRL/betterquesting/
QuestProgress.json`, 403 quests, including every boss fight worth announcing.
That file is the source, alongside the vanilla statistics file.

## The two milestone sources, and why both

Extracted from the pack's own `DefaultQuests.json` (every `bq_standard:hunt`
task and its `target:8`): 22 hunt quests, among them Rahovart, Asmodeus,
Amalgalich, both Ice and Fire dragons and the Ender Dragon. So:

| source | catches | misses |
|---|---|---|
| `QuestProgress.json` | a boss killed by someone doing the quest | a boss killed by someone who never opened the quest book |
| `stats/<uuid>.json` → `stat.killEntity.*` | any kill, quest or no quest | anything that is not a kill |

Both are seeded. Neither Lycanites nor Battle Towers ships an advancement, and
neither writes anything to the log when its boss dies, so the statistics file is
the only route to that second row.

**Known gap, stated rather than papered over:** Dregora's own dimensions
(`Underneath`/DIM3, DIM111, DIM254) produce no quest, no advancement and no log
line, so "entered a new world for the first time" is only covered where a quest
happens to cover it. Catching all of them needs the player NBT in
`playerdata/<uuid>.dat` and an NBT parser dependency. Not worth it yet; recorded
so the next person does not go looking for the log line that would do it.

**A scan flushes first.** Better Questing writes progress when the world saves,
not when a quest completes. Measured: an RCON `save-all flush` moved the file's
mtime immediately. Without it the bridge congratulates people minutes late,
often after they have logged off, which is a different and worse feature.

## Reading the log file, not `docker logs`, and not a mod

A Forge chat mod would give clean events. It would also mean a new jar in
`mods/`, a pack the `modpack.lock` SHA no longer describes, a permanent entry in
`check-drift.sh`, and a restart to install. The log file is already there and
the bot already mounts `/srv/mc/pack` for Apply, so this adds **no new access
and no pack drift at all**.

`docker logs` was the other candidate and is worse: the container's stdout
carries the pack's own ANSI colouring — measured, lines arrive as
`> [K[10:13:35] …` and `[33;1m[11:11:40] …`. The file on disk is clean.

The reader watches for both rotation signals (`latest.log` is replaced on every
restart and at midnight) because the failure mode of getting that wrong is
silence, not an error. It starts at the END of the file: replaying it would push
hours of old conversation into Discord as if it had just been said.

## The thread name is the loop guard

Measured on the Host — an RCON `say` comes back as:

```
[16:52:51] [RCON Client #6/INFO] [net.minecraft…DedicatedServer]: [Rcon] hello
```

on the **RCON Client** thread, while a player's chat is on the **Server thread**.
The parser accepts only `Server thread`, so anything the bridge pushes into the
game cannot be read back out and re-delivered. It cannot echo itself
structurally, rather than by a filter that a later reader might mistake for
redundant.

(`tellraw`, which is what is actually used, prints nothing to the log at all —
also measured. The thread check is correct anyway, including for a future change
that reaches for `say`.)

`tellraw` over `say` for a second reason: `say` from RCON renders to players as
`[Rcon] …`, which tells them nothing true about who spoke.

## The web app never opens an RCON connection

Everything that crosses becomes a `chat_message` row, and the bot is the only
process that drains that table to the Game Server. The web app writes rows and
reads rows.

This is not tidiness. README rule 3: `max-tick-time=-1` is mandatory here
because OTG structure generation legitimately blocks the main thread for
minutes. A request handler awaiting RCON would hang the chat box for exactly as
long, and a visitor cannot tell that apart from a broken site. It is the same
shape as the Status Poller in `CONTEXT.md` — one process owns the connection, as
a structural fact rather than a convention.

Undelivered messages are retried, not dropped, because an unreachable Game
Server is a normal temporary state here. But only for ten minutes: a server that
was down for an hour must not come back to an hour of conversation arriving at
once, addressed to people who logged off long ago.

## The mirror channel is not `allowed_channel`

`allowed_channel` answers "where does the bot accept commands". `bridge_channel`
answers "which channel mirrors the game", with a `kind` separating chat from
milestones. Reusing one table would pour every in-game line into the admin
command channel.

Both fail closed the same way: no rows, nothing mirrored anywhere.

## Two trust boundaries, neither optional

**Into the game.** Text typed by a stranger on a public page ends up inside a
`tellraw` argument, which is JSON the Game Server parses. The payload is built
with `JSON.stringify` and never interpolated; `§` is stripped rather than
escaped, because left in it lets anyone paint their text like a server
announcement; newlines are collapsed, because a newline in a chat line is a
second chat line. `npm run bridge:check` proves the hostile string comes back
out of the JSON intact and inert.

**Into Discord.** Every relayed message is sent with
`allowedMentions: { parse: [] }`. Without it, `@everyone` typed in game pings
the guild.

## Consequences

- The bot needs `GuildMessages` and `MessageContent`. **`MessageContent` is a
  privileged intent** and must be enabled in the Discord Developer Portal or the
  gateway refuses the connection. ADR-0008 notes this application is shared with
  DISCO NIGHT on a token that was meant to be rotated — enabling it widens what
  that application can read, so rotate the token first, not after.
- `player_milestone` makes announcements one-time. The first ever scan records
  everything it finds **without announcing**, or the bridge would open by
  congratulating everybody for things they did before it existed.
- Nothing here writes to `/srv/mc/pack`. `check-drift.sh` stays silent.
