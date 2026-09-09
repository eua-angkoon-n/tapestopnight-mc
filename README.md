# tapestopnight-mc

RLCraft Dregora game server on `tapestopnight.com`, plus the Control Plane that operates it:
a web app for public server info and admin config, and a Discord bot for operations.

- **Vocabulary** — [`CONTEXT.md`](./CONTEXT.md). Use these words; they are chosen.
- **Why anything is the way it is** — [`docs/adr/`](./docs/adr/). Read before changing shape.

## The three rules that will bite you

1. **Never hand-edit `server.properties` on the Host.** Postgres is the source of truth; the
   file is generated output. Your edit survives until the next Apply, then vanishes.
   → [ADR-0002](./docs/adr/0002-postgres-source-of-truth.md)
2. **`-Xmx7G` is deliberate and near the Host's limit.** Java 8's G1 does full GC on a
   single thread, so pauses scale with heap. The Aikar flags and GC logging are not
   decoration — they are the mitigation. Do not strip them.
   → [ADR-0012](./docs/adr/0012-heap-size-on-measured-host.md)
3. **A server that looks hung for five minutes is normal.** `max-tick-time=-1` is mandatory
   because OTG structure generation takes minutes. Never add a healthcheck, never conclude
   "down" from an RCON timeout. → [ADR-0005](./docs/adr/0005-docker-itzg-minecraft-server.md)

## Layout

```
apps/web        Next.js — public info pages + admin config UI
apps/bot        discord.js — slash-command tree
packages/core   auth · config · control   (shared, so authorisation cannot drift)
overlay/        ONLY the pack config/scripts we deliberately changed
db/             migrations + the Edit Tier seed (policy, therefore source)
deploy/         compose, Dockerfiles, modpack.lock, fetch + drift scripts
docs/adr/       the decisions
```

## What is deliberately not in this repo

The modpack payload (565 MB of jars), the world, `server.properties`, and every secret.
The pack is pinned by SHA256 in [`deploy/modpack.lock`](./deploy/modpack.lock) and fetched at
deploy time. → [ADR-0009](./docs/adr/0009-git-excludes-vendor-payload.md)

## Runbook

```bash
cp .env.example .env      # then fill it in; .env is gitignored
```

**Deploy.** Images are built in CI and pushed to GHCR; the Host only pulls. Do **not** run
`docker compose build` on the Host — a Next.js build peaks at 1–2 GB beside a 4 GB JVM and the
OOM killer picks the biggest process, which is the game server, with players connected.
→ [ADR-0010](./docs/adr/0010-private-repo-ci-builds.md)

```bash
docker compose pull && docker compose up -d
```

**Change a config value.** Through the admin web UI, then press Apply. Keys are tiered
`FREE` / `GUARDED` / `LOCKED`; `LOCKED` keys are not rendered as inputs at all, on purpose.
→ [ADR-0003](./docs/adr/0003-config-edit-tiers.md),
[ADR-0007](./docs/adr/0007-design-system.md)

**Change the Server Icon.** Upload ONE high-resolution square image in the admin UI; the
64×64 PNG Minecraft needs is derived from it, and the original is what the website shows.
Then press Apply — Minecraft reads the icon file only at process start, so the change needs
the restart. Do not upload a 64px file: it would look terrible on the site, and an image that
is not exactly 64×64 is **silently ignored** by Minecraft, with no error anywhere.
→ [ADR-0013](./docs/adr/0013-server-icon-in-postgres-resized-in-browser.md)

```bash
npm run icon:check          # exercises the 64x64 validator and the header parsers
```

**Run a bot command.** The tree is `/server`, `/players`, `/info` and `/config`.
`/server status`, `/players list` and `/info *` are open to anyone in an allowed channel;
the lifecycle and config commands need the Discord admin role. Nothing in the tree can
touch the **Host** — only the container.
→ [ADR-0014](./docs/adr/0014-bot-authorisation-surface.md)

```bash
npm run bot:check           # every command has a decided tier; none can reach the Host
```

**Let the bot answer in a channel.** The allowlist fails closed: with no rows the bot
answers nowhere. It is deliberately not editable from the UI, and the bot's refusal
message prints this statement with the channel id already filled in.

```sql
INSERT INTO allowed_channel (channel_id, note) VALUES ('<channel id>', 'ห้องหลัก');
```

**⚠ Before starting the bot for the first time: stop DISCO NIGHT.** Discord permits one
gateway session per token and this reuses that application's. Two processes on one token
knock each other offline in a loop — and because web login reads guild roles through this
same application, that also breaks the website's admin check. The bot clears stale global
commands on boot so DISCO NIGHT's do not linger.
→ [ADR-0008](./docs/adr/0008-reuse-discord-application.md)

**Check for config drift.** An overlay cannot see someone hand-editing a mod config on the
Host. Runs daily at 05:30 Bangkok; run it by hand any time:

```bash
deploy/check-drift.sh              # vs the accepted baseline — what cron runs
deploy/check-drift.sh --accept     # record the current state as accepted
deploy/check-drift.sh --vs-pack    # vs (verified zip + overlay), the ADR-0009 question
```

It compares against an **accepted baseline**, not against the pack, and that is deliberate:
compared against the pristine zip the first real run reported 136 differences and not one was
a human edit — Forge mods rewrite their own `.cfg` on first boot and srpmixins alone generates
96 loot tables. A daily job reporting 136 items is one nobody reads. Re-run `--accept` after a
deliberate pack upgrade, never to silence a report you have not read.

**Backups.** Daily at 05:00 Bangkok, 14 kept, into `/srv/mc/backups`:

```bash
deploy/backup.sh                   # both
deploy/backup.sh db                # Postgres only
deploy/backup.sh world             # world only
```

The world is flushed over RCON (`save-off`, `save-all flush`) before it is copied, so the
archive is consistent rather than hopeful, and saving is re-enabled by a trap even if the
archive fails. A world left with saving disabled silently discards everything until the next
restart, which is worse than a failed backup.

**Pre-generate the world.** Runs at the normal `7G` with everything else up, using
Chunk Pregenerator `V1.12-2.5.1` (the version the pack's own readme names). The mod is
temporary: install, generate, remove.

```bash
cp /srv/mc/dist/chunkpregen-2.5.1.jar /srv/mc/pack/mods/   # then restart the container
docker exec tapestopnight-mc rcon-cli "pregen gen startradius square s s b5000"
docker exec tapestopnight-mc rcon-cli "pregen info ShowTaskList"    # progress
docker exec tapestopnight-mc rcon-cli "pregen info stop"            # pause; resume with 'continue'
```

The task list survives a restart, so a stopped or crashed run resumes with
`pregen info continue` rather than starting over.

Two things the pack already gets right, worth knowing before you go looking for them:
`fermiummixins` force-disables **OpenTerrainGenerator's own** pregenerator (not this mod)
because it burns CPU when idle, and it enables a "Save To Disk Crash Improvement" guard
specifically for pregeneration.

`deploy/backup.sh world` refuses to run while a pregen task is active, on purpose:
`save-off` does not pause the generator, it just queues generated chunks in the heap next
to a JVM already near its cgroup limit. The Postgres half still runs.

Afterwards: remove the jar, restart, and set the worldborder the pack's readme demands —
that number concerns the border, not the pregen radius, so a 5,000-block pregen does not
break the in-world teleporters.

```bash
docker exec tapestopnight-mc rcon-cli "worldborder set 40000"
```
→ ADR-0012

## Grant someone admin

Assign them the Discord role in `DISCORD_ADMIN_ROLE_ID`. That is the only grant path, and it
governs the web UI and the bot identically — there is no second list to keep in sync. The
`admin_allowlist` table is break-glass for a Discord outage, not for routine administration.
→ [ADR-0004](./docs/adr/0004-discord-guild-roles-authority.md)
