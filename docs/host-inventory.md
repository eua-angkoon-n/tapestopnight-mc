# Host inventory — measured, not assumed

Phase 0 of the plan. These are observations, not decisions, which is why they live here and
not in an ADR. Measured over SSH on **2026-09-08**; re-measure before trusting them again.

Host: `217.216.111.122` — `vmi3563957.contaboserver.net` (Contabo VPS)

## Hardware and OS

| | |
|---|---|
| RAM | **11,960 MB total · 942 MB used · 11,017 MB available** |
| Swap | **none** · `vm.swappiness=60` |
| CPU | **6 vCPU**, AMD EPYC (with IBPB) |
| Disk `/` | `/dev/sda1` — 193 GB, 4.6 GB used, **189 GB free (3%)** |
| OS | Ubuntu 24.04.4 LTS, kernel 6.8.0-138-generic, x86_64 |

The plan's go/no-go rule wanted ≥ 30 GB free disk and enough RAM headroom. Both pass with
room to spare — disk by a factor of six.

## Already installed

| | Version |
|---|---|
| Docker | **29.8.0** |
| Docker Compose | **v5.5.1** |
| Caddy | serving `:80` and `:443`, admin API on `127.0.0.1:2019` |

No nginx, no Apache, no host-level PostgreSQL (`postgresql.service` inactive — the Postgres
process seen in `ps` belongs to the ledger container).

**No `fail2ban`.** Worth knowing in both directions: the three failed SSH password attempts
during setup banned nothing, and SSH on port 22 currently has no brute-force protection.

## The ledger system — what we must not disturb

Compose project **`family-ledger`** on network `family-ledger_default`:

| Container | Image | Binding | Memory |
|---|---|---|---|
| `family-ledger-app-1` | `family-ledger-app` (local build) | `127.0.0.1:3001` → `3000` | **47.3 MB** |
| `family-ledger-db-1` | `postgres:16-alpine` | `5432` unpublished | **34.7 MB** |

**~82 MB combined.** ADR-0011 feared this could exceed 1.5 GB and invalidate the whole plan;
it is eighteen times under that. ADR-0012 supersedes it on this evidence.

Two things it already does right, which our compose should match rather than undercut: the app
is bound to **loopback only** and reached through Caddy, and the database port is **not
published** to the Host at all.

## Caddy — the whole config today

```
ledger.tapestopnight.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3001
}
```

Four lines. Our site is an analogous block, so ADR-0001's proxied apex needed no new web
server and no port contention.

**RESOLVED — the Cloudflare/ACME wrinkle did not materialise.** This section originally warned
that Caddy's HTTP-01 challenge would have to traverse the orange cloud and might need a
Cloudflare Origin CA certificate or DNS-01 instead. Cloudflare passes
`/.well-known/acme-challenge` through, and issuance succeeded first try: the logs show
`served key authentication` to several Cloudflare edge IPs, then
`certificate obtained successfully`.

Worth recording because it is misleading: for the few seconds while the certificate is being
issued, the apex returns Cloudflare **525 SSL Handshake Failed**. That is the origin not having
a certificate yet, not a broken configuration. Wait and retry before changing anything — I
briefly diagnosed it as a failure because I tested seven seconds too early.

## Firewall — `ufw` active

Allowed inbound: **22, 80, 443** (v4 and v6). Nothing else.

**This is why an external probe of 25565 reported "closed" during reconnaissance.** The port
was never the problem; `ufw` was. Opening 25565 is required and is the only firewall change the
plan needs.

## Listening sockets

| Port | Process |
|---|---|
| 22 | `sshd` (all interfaces) |
| 80, 443 | `caddy` |
| 2019 | `caddy` admin API — **loopback only**, correct |
| 3001 | `docker-proxy` → ledger app — **loopback only**, correct |
| 53 | `systemd-resolved` — loopback only |

## Follow-ups this surfaced — all closed (2026-09-09)

- ~~Open **25565/tcp** in `ufw`.~~ Done; inbound is 22, 80, 443, 25565 and nothing else.
- ~~Add a **4 GB swap file with `vm.swappiness=1`**.~~ Done — 4095 MB swap, `vm.swappiness = 1`,
  and it is a safety net for the *other* processes only. Swapping a JVM heap destroys TPS.
- ~~**Disable SSH password authentication.**~~ Done. Two subtleties worth recording:

  Two files disagreed — `50-cloud-init.conf` said `yes` and `60-cloudimg-settings.conf` said
  `no` — and sshd takes the **first** value it reads, so the `50-` file was winning and the
  `60-` file looked like protection that was not there. The `50-` file is the one that was
  changed. `PermitRootLogin` is now `prohibit-password` as well.

  The change was made behind a **dead-man switch**: a `systemd-run --on-active=5min` timer
  armed to restore the backup before anything was edited, cancelled only after a brand-new
  key-based connection was proven to work. Locking yourself out of a box you administer over
  SSH is a self-inflicted outage, and the recovery path (Contabo's console) is slow.

  Verified after: a fresh key connection succeeds; `ssh -o PreferredAuthentications=password`
  is refused with `Permission denied (publickey)`.

- ~~Namespace our compose project so nothing collides with `family-ledger`.~~ Done.

**`fail2ban` is still not installed, and that is now a deliberate choice.** With password
authentication off, SSH brute force has nothing to guess: an attacker needs a private key, and
fail2ban would only be trimming log noise. Revisit if a password-authenticated service is ever
added.

## Scheduled jobs (added 2026-09-09)

`/etc/cron.d/tapestopnight`, times pinned with `CRON_TZ=Asia/Bangkok` because the Host runs
Europe/Berlin, the containers run Asia/Bangkok, and the players are in Thailand.

| When (Bangkok) | What |
|---|---|
| 05:00 daily | `deploy/backup.sh all` → `/var/log/tapestopnight-backup.log` |
| 05:30 daily | `deploy/check-drift.sh` → `/var/log/tapestopnight-drift.log` |

Backups land in `/srv/mc/backups/{db,world}`, 14 of each kept. The drift baseline lives at
`/srv/mc/state/drift-baseline.sha256`.
- Reuse of `family-ledger-db-1` for our schema was considered and **declined**: sharing the
  ledger's database container would couple our migrations, restarts and backups to a system we
  promised not to disturb. A separate Postgres costs ~300 MB and buys full isolation.
