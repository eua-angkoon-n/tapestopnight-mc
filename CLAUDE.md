# Operating this system

This file is the shared contract for every agent that touches the tapestopnight
Host. It holds only what is dangerous for *any* agent to be ignorant of. Vocabulary
lives in [`CONTEXT.md`](./CONTEXT.md); decisions live in [`docs/adr/`](./docs/adr/);
procedures live in the individual agent files. Do not grow this file with things
only one agent needs — every line here is paid for in every subagent's context.

## The one absolute rule

**Never touch `/opt/family-ledger` or anything named `family-ledger-*`.**

The Host runs a second, unrelated system — compose project `family-ledger`,
containers `family-ledger-app-1` and `family-ledger-db-1`, served at
`ledger.tapestopnight.com`. We rent part of this machine, not the machine. Do not
read it, stop it, restart it, inspect its logs, or name it in a command. To ask
whether the Host as a whole is under pressure, measure the Host in aggregate
(`free -m`, `df -h`, `docker stats` with no container named) and never single that
project out. `.claude/hooks/guard.ps1` enforces this and will refuse the command.

## The Host

`217.216.111.122` (`vmi3563957.contaboserver.net`) — Contabo VPS, Ubuntu 24.04,
6 vCPU, 12 GB RAM, 4 GB swap (`vm.swappiness=1`), 193 GB disk. `ufw` allows
22, 80, 443, 25565/tcp, 24454/udp and nothing else. Caddy fronts everything:
`tapestopnight.com` to `127.0.0.1:3002`, `ledger.tapestopnight.com` to `127.0.0.1:3001`.

Compose project `tapestopnight-mc`, defined at `/srv/mc/repo/deploy/docker-compose.yml`:

| Container | What it is |
|---|---|
| `tapestopnight-mc` | the Game Server — Forge 1.12.2, RLCraft Dregora, `MEMORY=7G` |
| `tapestopnight-db` | Postgres 16 — the Desired Config, source of truth |
| `tapestopnight-socket-proxy` | scoped Docker access for the Control Plane |
| `tapestopnight-poller` | the **only** thing that probes the Game Server |
| `tapestopnight-web` | Next.js — public pages + admin config UI |
| `tapestopnight-bot` | discord.js — `/server` `/players` `/info` `/config` |

Scheduled: `/etc/cron.d/tapestopnight` — backup 05:00 and drift check 05:30, both
Bangkok (`CRON_TZ` is set because the Host runs Europe/Berlin).

## How to reach it

Never call `ssh` or `scp` directly. Two wrappers, and the difference between them
is the whole safety model:

```bash
.claude/bin/vps-read.sh 'docker ps'     # diagnosis — runs without prompting
.claude/bin/vps-do.sh   'docker ...'    # any change — always asks the operator
```

**Diagnose freely. Ask before you change anything.** Reading logs, inspecting
containers, measuring resources, querying over RCON — go, no permission needed.
Anything that mutates the Host goes through `vps-do.sh` *and* through the proposal
format below.

## Before any mutating action

Five fields, in the Thai report, every time:

1. **The command**, verbatim, exactly as it will run.
2. **Blast radius** — which containers, which paths, who notices.
3. **The evidence that rules out the known-normal explanation** (see the four
   prohibitions below — most "problems" here are one of them).
4. **The rollback** — the command that puts it back.
5. **What happens if we do nothing for 30 minutes.**

Field 5 is not filler. It retires more of these proposals than the other four
together, and the honest answer is often "nothing".

## The four prohibitions, with their reasons

Reasons are included on purpose. A bare prohibition gets rationalised past at
23:00; a reason does not.

**1. A server that looks hung for five minutes is normal. Never conclude "down"
from an RCON timeout, and never add a healthcheck.** `max-tick-time=-1` is
mandatory for this pack because OpenTerrainGenerator legitimately blocks the main
thread for minutes during structure generation. The itzg image ships a healthcheck
and it is deliberately disabled — with it on, a healthy server reports as failed
and gets restarted mid-chunk-write. `stop_grace_period` is 10m for the same
reason: cutting a world save short is how region files corrupt. See ADR-0005.

**2. Never run `docker compose build` on the Host.** A Next.js build peaks at
1–2 GB of RSS beside a 7 GB JVM. The OOM killer picks the largest process, which
is the Game Server, with players connected. Images are built in CI and pushed to
GHCR; the Host only ever pulls. See ADR-0010.

**3. Never hand-edit `server.properties`.** Postgres is the source of truth and
the file is generated output. Your edit survives until the next Apply, then
vanishes. Wanting to edit it is the reliable sign you are working the wrong stage
of the pipeline. See ADR-0002.

**4. `-Xmx7G`, the Aikar flags and the GC logging are load-bearing.** Java 8's G1
does full GC on a single thread, so pauses scale with heap; the flags are the
mitigation, not decoration. 8G was measured at 9.04 GiB RSS with zero players.
Present numbers if you think this should change — changing it needs a new ADR.
See ADR-0012.

## `/srv/mc/repo` is not ground truth

It is a **partial, non-git copy** — `db/`, `deploy/`, `overlay/` only, no `.git`,
no `apps/`, no `docs/`. You cannot `git pull` it and you must not assume it matches
`main`. As of 2026-09-13 it has drifted in three files, one of which
(`deploy/backup.sh`) is **ahead** of git and carries a real fix that exists nowhere
else. Check before you trust it; overwrite it only deliberately.

The real repo is this working copy on the laptop. `/srv/mc/pack` is the modpack
and world — vendor payload, not in git (ADR-0009).

## Who owns what

Deletion rights follow the **path**, not the symptom. Resolve ownership by looking
up where the bytes live, not by arguing about whose problem it is.

| Path | Sole deletion owner |
|---|---|
| `/srv/mc/backups/**` | `data-ops` |
| `/srv/mc/pack/logs/**`, crash reports, GC logs | `mc-server-ops` |
| `/srv/mc/repo`, `/srv/mc/dist`, images and volumes | `release-ops` |
| `/srv/mc/state/drift-baseline.sha256` | `release-ops` |
| everything else on the Host | `host-ops` |
| `/opt/family-ledger/**`, `family-ledger-*` | **nobody, ever** |

The team: `ops-triage` (routes), `mc-server-ops` (the JVM and the world),
`host-ops` (the Linux box), `stack-dev` (the TypeScript, no Host access),
`release-ops` (CI to GHCR to running container, and drift), `data-ops` (backups,
restores, the config DB). No agent may spawn another.

## Routing discriminators

Mechanical, so that no two agents have to negotiate.

- **"Lag."** If `vmstat 1 5` shows swap-in > 0 or steal > 5%, `host-ops` answers
  first, unconditionally — a JVM diagnosis taken under memory pressure produces a
  confident, wrong story about mod ticks. Clean memory, one core pegged, low TPS
  means a tick stall, which is `mc-server-ops`.
- **"It's down."** Every "down" that arrives via Discord is a *poller claim*, not
  an observation. Not actionable until corroborated three ways: a direct SLP probe
  from the Host, `docker inspect` uptime, and a `latest.log` timestamp delta.
  Container healthy and log advancing means a poller or bot bug, which is
  `stack-dev`, and `mc-server-ops` refuses the ticket.
- **"Apply didn't do anything."** Ownership follows the pipeline stage: DB row
  written (`data-ops`), then apply code in `packages/core` (`stack-dev`), then
  rendered file on disk and server reload (`mc-server-ops`).
- **"Web is 502."** Run `curl -s -o /dev/null -w '%{http_code}' localhost:3002`
  from the Host. Responds means proxy or TLS, which is `host-ops`. No response but
  container `Up` means an app crash, which is `stack-dev`. Container restarting
  means a bad image tag — `release-ops` rolls back first, `stack-dev` diagnoses
  after.
- **"Bot is offline / replying twice."** ADR-0008: one Discord gateway session per
  token, and this application is shared with DISCO NIGHT. Any proposal that
  restarts or scales the bot must first state whether a second session could exist.
  `--scale` is nobody's verb.

## Language

Repo artifacts — this file, agent definitions, commit messages, ADRs, code
comments — in **English**, matching everything already here. Reports to the
operator in **Thai**. Keep the vocabulary in `CONTEXT.md` when writing either:
Host, Game Server, Control Plane, Desired Config, Rendered Config, Apply, Edit
Tier, Status Poller, Chat Bridge, Milestone, Player Link. Those words are chosen.

## Secrets

`/srv/mc/repo/deploy/.env` (mode 600) holds `RCON_PASSWORD`, `POSTGRES_PASSWORD`,
`AUTH_SECRET` and `DISCORD_BOT_TOKEN`. Never read it — the guard refuses. To check
whether a variable is set without printing it:

```bash
.claude/bin/vps-read.sh 'grep -c ^RCON_PASSWORD= /srv/mc/repo/deploy/.env'
```
