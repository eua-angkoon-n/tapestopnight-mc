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

Four lines. Our site is an analogous block, so ADR-0001's proxied apex needs no new web server
and no port contention. One wrinkle to expect: with the apex behind Cloudflare's orange cloud,
Caddy's automatic HTTP-01 challenge has to traverse the proxy. If that misbehaves, the fix is a
Cloudflare Origin CA certificate or a DNS-01 challenge — not disabling the proxy.

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

## Follow-ups this surfaced

- Open **25565/tcp** in `ufw`.
- Add a **4 GB swap file with `vm.swappiness=1`** — required by ADR-0012's mitigations, and
  `vm.swappiness` is currently the default 60.
- **Disable SSH password authentication.** Key auth now works; the box has no `fail2ban`, and
  port 22 is open to the world. This is the cheapest hardening available and closes the
  brute-force exposure that the setup attempts made visible.
- Namespace our compose project so nothing collides with `family-ledger` — distinct project
  name, network, container names, and volumes.
- Reuse of `family-ledger-db-1` for our schema was considered and **declined**: sharing the
  ledger's database container would couple our migrations, restarts and backups to a system we
  promised not to disturb. A separate Postgres costs ~300 MB and buys full isolation.
