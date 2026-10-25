# tapestopnight-mc

Homestead game server on `tapestopnight.com`, plus the Control Plane that operates it:
a web app for public server info and admin config, and a Discord bot for operations.

Minecraft 1.20.1, Fabric, [Homestead 1.3.7](https://www.curseforge.com/minecraft/modpacks/homestead-cozy).
Until September 2026 this was RLCraft Dregora on Forge 1.12.2 — if something in here reads as
though it were written for a different game, that is why, and it is a bug worth fixing.

- **Vocabulary** — [`CONTEXT.md`](./CONTEXT.md). Use these words; they are chosen.
- **Why anything is the way it is** — [`docs/adr/`](./docs/adr/). Read before changing shape.

## The three rules that will bite you

1. **Never hand-edit `server.properties` on the Host.** Postgres is the source of truth; the
   file is generated output. Your edit survives until the next Apply, then vanishes.
   → [ADR-0002](./docs/adr/0002-postgres-source-of-truth.md)
2. **`-Xmx8G` is deliberate, measured, and a ceiling.** RSS is 9.24 GiB idle, 9.51 GiB peak
   under pregeneration, of a 10 GiB `mem_limit` on a shared 12 GB Host — it passes with almost
   no headroom, and the operator chose on 2026-09-14 to keep it. Do not raise `max-players`
   without watching TPS and RSS together, and never raise `mem_limit` to make the heap fit.
   The Aikar flags and GC logging are the mitigation, not decoration — and the GC flags had to
   change spelling entirely, because the Java 8 ones were *removed* in JDK 16 and a JVM given
   them refuses to boot. → [ADR-0018](./docs/adr/0018-heap-on-fabric-java17.md)
3. **A server that looks hung for five minutes is normal.** `max-tick-time=-1` is mandatory
   because generating chunks for a 374-mod pack takes minutes, and first boot exceeds the
   image's start period outright. Never add a healthcheck, never conclude "down" from an RCON
   timeout. → [ADR-0005](./docs/adr/0005-docker-itzg-minecraft-server.md)

## Layout

```
apps/web        Next.js — public info pages + admin config UI
apps/bot        discord.js — slash-command tree
packages/core   auth · config · control   (shared, so authorisation cannot drift)
overlay/        ONLY the pack config/scripts we deliberately changed
db/             migrations + the Edit Tier seed (policy, therefore source)
deploy/         compose, Dockerfiles, modpack.lock, extra-mods.lock, fetch + drift scripts
docs/adr/       the decisions
```

## What is deliberately not in this repo

The modpack payload, the world, `server.properties`, and every secret.
The pack is pinned by SHA256 in [`deploy/modpack.lock`](./deploy/modpack.lock) and fetched at
deploy time. Mods added on top of the pack are pinned the same way in
[`deploy/extra-mods.lock`](./deploy/extra-mods.lock).
→ [ADR-0009](./docs/adr/0009-git-excludes-vendor-payload.md),
[ADR-0017](./docs/adr/0017-extra-mods-outside-the-pinned-pack.md)

## Working on this repo

**Do this once per clone, before your first commit:**

```bash
git config core.hooksPath .githooks
```

Git does not install hooks from a checkout, so without it `.githooks/` is decoration. Two
hooks live there: `pre-commit` runs the `gitleaks` secret scan ADR-0010 requires, and
`pre-push` refuses a direct push to `main`. Both fail closed. `pre-commit` also refuses to run
if `gitleaks` is missing, rather than skipping the scan — `winget install gitleaks`.

**`main` takes merged pull requests, not pushes.** The GitHub ruleset that would enforce that
is checked in at [`.github/rulesets/main.json`](./.github/rulesets/main.json) and **is not in
force**: rulesets are a paid feature on a private repository, and this repository stays private
for reasons ADR-0010 still holds. Until the plan changes, the `pre-push` hook is all that
stands there, and it is a habit-catcher on one laptop — not protection.
→ [ADR-0021](./docs/adr/0021-branch-protection-without-github-pro.md)

## Runbook

```bash
cp .env.example .env      # then fill it in; .env is gitignored
```

**Deploy.** Images are built in CI and pushed to GHCR; the Host only pulls. Do **not** run
`docker compose build` on the Host — a Next.js build peaks at 1–2 GB beside an 8 GB JVM and the
OOM killer picks the biggest process, which is the game server, with players connected.
→ [ADR-0010](./docs/adr/0010-private-repo-ci-builds.md)

```bash
docker compose pull && docker compose up -d
```

**Bootstrap the first boot.** The pack ships its own `server.properties` and the server
starts on it once, before anything has Applied. That boot is when the world is generated,
so the keys that must be right then are set by hand — RCON, `max-tick-time=-1` and
`level-name`. The script needs `RCON_PASSWORD`, which lives in the file nothing may read,
so run it inside the container compose already injects it into:

```bash
docker compose run --rm -T -v /srv/mc/repo/deploy:/scripts:ro --entrypoint /bin/sh mc \
  -c "python3 /scripts/seed-server-properties.py /data/server.properties"
```

**After a pack change, clear `config_key` before seeding.** `db/seed/0001-seed.sql`
updates tiers and reasons but deliberately never touches `value`, so an admin's edit
survives a re-seed. On a pack change that protection points the wrong way: every row
still holds the previous pack's value, and seeding alone leaves `level-type=OTG` and
`level-name` aimed at a world that no longer exists. ADR-0002 means nobody catches it
by reading `server.properties` — the file is output, and a wrong one looks exactly as
authoritative as a right one.

```sql
DELETE FROM config_key;   -- right exactly once per pack, wrong every other time
```

**Change a config value.** Through the admin web UI, then press Apply. Keys are tiered
`FREE` / `GUARDED` / `LOCKED`; `LOCKED` keys are not rendered as inputs at all, on purpose.
→ [ADR-0003](./docs/adr/0003-config-edit-tiers.md),
[ADR-0019](./docs/adr/0019-cozy-design-system.md)

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

**Turn on the Chat Bridge.** In-game chat, the website's chat page and a Discord channel are
one bridge (ADR-0015). Three things have to be true before it says anything:

1. **`MessageContent` is enabled** for the application in the Discord Developer Portal. It is a
   privileged intent; without it the gateway refuses the connection outright. ⚠ ADR-0008 — this
   application is still DISCO NIGHT's, so **rotate the token before widening what it can read**.
2. **The channels are named.** Like `allowed_channel` this fails closed, and for the same reason
   it is a separate table: `allowed_channel` says where the bot takes *commands*, this says which
   channel mirrors the *game*.

   ```sql
   INSERT INTO bridge_channel (channel_id, kind, note) VALUES
     ('<channel id>', 'chat',      'ห้องแชทเชื่อมเกม'),
     ('<channel id>', 'milestone', 'ห้องประกาศความสำเร็จ');
   ```

   The key is `(channel_id, kind)`, so **the same channel may take both** — which
   is how this server runs it. The bot ignores its own messages, so its
   congratulations do not come back as chat.

   The bot has no guild-wide permissions on purpose; it is granted per channel.
   A new channel must give the bot's role **View Channel** and **Send Messages**
   or the bridge is silent with nothing anywhere saying why.
3. **The milestone allowlist is seeded**, or nothing is ever worth announcing:

   ```bash
   docker exec -i tapestopnight-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"      < db/seed/0002-milestones.sql
   ```

The parser is tested against log lines captured from this Host, with no token, database or game
server needed:

```bash
npm run bridge:check
```

**Account linking needs Caddy configured.** The website matches a visitor's address against the
address that player logged in from, and it can only do that if Caddy tells it the real one — the
apex is Cloudflare-proxied, so out of the box every request appears to come from Cloudflare. The
`trusted_proxies` + `header_up X-Real-Client-IP` block in
[`deploy/caddy/Caddyfile`](./deploy/caddy/Caddyfile) is what makes it believable, and the
Cloudflare ranges in it **change** — re-fetch, never copy forward.

Expect the address match to fail for a good share of players: the game is IPv4-only while the
website has AAAA records, and two people in one house cannot be told apart. That is why `!link`
exists, and why it is built to be as smooth as the automatic path. → ADR-0016

**Voice chat.** Proximity audio through
[Simple Voice Chat](https://www.curseforge.com/minecraft/mc-mods/simple-voice-chat), which
**Homestead ships as one of its own mods** (ADR-0017).

Nothing to install, for anybody. Under Dregora this mod was pinned on top of the pack in
`deploy/extra-mods.lock` and players had to drop one exact jar version into their instance or
get silence with no error anywhere. That whole runbook is gone: everyone who installs the pack
has the mod, at the version the pack pins.

`deploy/extra-mods.lock` is now empty. The mechanism stays — it is what makes "which mods are
on this server, beyond the archive" answerable — and an empty list is a truthful answer:

```bash
deploy/fetch-extra-mods.sh --check    # says so explicitly rather than claiming a clean check
```

What is still ours is the **configuration**, in
`overlay/config/voicechat/voicechat-server.properties` — note the `voicechat/` directory; a
file one level up is silently ignored, which is how `voice_host` came to be blank on a server
that otherwise looked deployed. Two values in it matter:

- `voice_host=mc.tapestopnight.com:24454` — **not** the apex. The apex is Cloudflare-proxied
  and does not carry UDP (ADR-0001), so packets aimed at it vanish silently. If voice connects
  but nobody can hear anyone, check this first: `tcpdump -ni any udp port 24454` while
  somebody talks.
- `force_voice_chat=false` — leave it. Setting it true throws away the property that lets a
  player without the mod join and play as normal.

The firewall is a second door and compose publishing the port is the first; both are already
open and neither changed with the pack:

```bash
sudo ufw allow 24454/udp     # already applied
```

The overlay is captured verbatim from the pack's own copy of that file — Homestead ships
`config/voicechat/voicechat-server.properties` alongside `voicechat-fabric-1.20.1-2.6.17.jar` —
with exactly those two values changed and both marked `OURS` in the file. ADR-0009's reason for
holding the whole file rather than a fragment is unchanged: it is what keeps
`check-drift.sh --vs-pack` quiet.

On the next pack upgrade, re-capture the pack's copy and re-apply the two values rather than
carrying the file forward. The mod gains settings between versions, and a stale overlay
overwrites the new ones with absence.

**Install the pack.** `fetch-modpack.sh` refuses to unpack into a non-empty pack
directory, and `prepare-host.sh` creates `logs/` inside it — so running them in that
order makes the second one refuse. Fetch first:

```bash
deploy/fetch-modpack.sh      # verify SHA256, unpack, drop client-only paths, apply overlay
deploy/prepare-host.sh       # then create logs/, which the JVM opens at startup
```

The refusal is correct and worth keeping: it is what stops a pack being unpacked over
the top of another one. `--force` exists for a same-pack refresh and is the wrong tool
for a version change — `unzip -o` does not clear `mods/`, so jars from the old pack
survive into a Minecraft version they do not support. Delete the pack directory instead.

**Site media is payload, but it is not disposable.** `/srv/mc/media` is bind-mounted
read-only into the web container and deliberately kept out of git (ADR-0009 — a 30 MB
mp4 makes every clone pay for it). Nothing backs it up, and nothing versions it, so an
upload that reuses an existing filename destroys the only copy. That is not
hypothetical: `about.webp` was overwritten on 2026-09-14 during the Homestead cutover
and the original could not be recovered from the Host, the image, or git.

Snapshot before replacing anything in there, and prefer a new filename to reusing one:

```bash
.claude/bin/vps-do.sh 'mkdir -p /srv/mc/archive/media-$(date +%Y%m%d) && \n  cp -a /srv/mc/media/. /srv/mc/archive/media-$(date +%Y%m%d)/'
```

**Check for config drift.** An overlay cannot see someone hand-editing a mod config on the
Host. Runs daily at 05:30 Bangkok; run it by hand any time:

```bash
deploy/check-drift.sh              # vs the accepted baseline — what cron runs
deploy/check-drift.sh --accept     # record the current state as accepted
deploy/check-drift.sh --vs-pack    # vs (verified zip + overlay), the ADR-0009 question
```

It compares against an **accepted baseline**, not against the pack, and that is deliberate.
Measured on Dregora: compared against the pristine zip the first real run reported 136
differences and not one was a human edit — mods rewrite their own config on first boot, and one
of them generated 96 loot tables by itself. A daily job reporting 136 items is one nobody
reads. Expect the same shape from Homestead at a different number; 374 mods is more config to
self-initialise, not less.

⚠ **The baseline on the Host is Dregora's and is meaningless now.** Re-run `--accept` once
Homestead has booted and settled — after a deliberate pack change is exactly what it is for.
Never to silence a report you have not read.

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

**Pre-generate the world.** Chunky ships **with** Homestead — `Chunky-1.3.146.jar`,
already in `mods/`, nothing to install or remove. That is the one thing that got
simpler: the Dregora procedure installed Chunk Pregenerator, ran it, and took it out
again.

Generating chunks while a player walks is the worst moment to do it, and this pack
builds terrain through Tectonic and TerraBlender with C2ME threading it. Pregeneration
moves that work to a time nobody is online.

```bash
R() { docker exec tapestopnight-mc rcon-cli "$1"; }

R "chunky world minecraft:overworld"
R "chunky spawn"          # centre on spawn, not 0,0 — the pack may move it
R "chunky radius 5000"
R "chunky shape square"
R "chunky quiet 300"      # or the log fills with progress lines
R "chunky selection"      # read it back before starting
R "chunky start"

R "chunky progress"       # ETA and rate
R "chunky pause"          # saves progress; `continue` resumes
R "chunky cancel"         # stops and forgets the task
```

Measured on this Host at radius 5000: **18.2 chunks/second, ETA 6 hours**, and CPU at
631% — which is all six vCPU. **The Host is shared** (CLAUDE.md), so a pregeneration
slows the whole machine, not just Minecraft. Run it when that is acceptable, and say
so if anyone else depends on the box.

To slow it down deliberately, `globalExecutorParallelism` in `config/c2me.toml`
controls how many threads chunk generation gets. It needs a restart, so `chunky pause`
first and `chunky continue` after — Chunky's `continueOnRestart` is `false`, and a
task will not resume by itself.

**The nether is eight times cheaper than it looks.** One nether block is eight
overworld blocks, so a nether radius of 625 already covers a 5000 overworld radius.
Generating the nether at 5000 would cover the equivalent of 40,000 overworld blocks,
which is mostly wasted time and disk.

`deploy/backup.sh world` refuses to run while a pregeneration is active, on purpose:
`save-off` does not pause the generator, it queues generated chunks in the heap next
to a JVM already near its cgroup limit. The Postgres half still runs. That guard asks
Chunky — it asked Chunk Pregenerator until 2026-09-14, and had been quietly matching
nothing since the pack changed.

⚠ Whether Homestead wants a worldborder is **not established**. Dregora's readme
demanded 40,000 because of its in-world teleporters; assuming the same here would be
inventing a requirement. Check the pack's own documentation before setting one.

## Grant someone admin

Assign them the Discord role in `DISCORD_ADMIN_ROLE_ID`. That is the only grant path, and it
governs the web UI and the bot identically — there is no second list to keep in sync. The
`admin_allowlist` table is break-glass for a Discord outage, not for routine administration.
→ [ADR-0004](./docs/adr/0004-discord-guild-roles-authority.md)
