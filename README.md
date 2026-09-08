# tapestopnight-mc

RLCraft Dregora game server on `tapestopnight.com`, plus the Control Plane that operates it:
a web app for public server info and admin config, and a Discord bot for operations.

- **Vocabulary** — [`CONTEXT.md`](./CONTEXT.md). Use these words; they are chosen.
- **Why anything is the way it is** — [`docs/adr/`](./docs/adr/). Read before changing shape.

## The three rules that will bite you

1. **Never hand-edit `server.properties` on the Host.** Postgres is the source of truth; the
   file is generated output. Your edit survives until the next Apply, then vanishes.
   → [ADR-0002](./docs/adr/0002-postgres-source-of-truth.md)
2. **`-Xmx4G` contradicts the modpack's readme on purpose.** It says 6G. Do not "fix" it —
   on an 8 GB Host that starts OOM-killing the game server.
   → [ADR-0011](./docs/adr/0011-4gb-heap-on-8gb-host.md)
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

**Check for config drift.** An overlay cannot see someone hand-editing a mod config on the
Host, so this reports mismatches against (verified zip + overlay):

```bash
deploy/check-drift.sh
```

**Pre-generate the world.** Stop the web app and bot, raise `MC_MEMORY=6G`, run the pregen,
then put it back to `4G` and remove the pregen mod. → ADR-0011

## Grant someone admin

Assign them the Discord role in `DISCORD_ADMIN_ROLE_ID`. That is the only grant path, and it
governs the web UI and the bot identically — there is no second list to keep in sync. The
`admin_allowlist` table is break-glass for a Discord outage, not for routine administration.
→ [ADR-0004](./docs/adr/0004-discord-guild-roles-authority.md)
