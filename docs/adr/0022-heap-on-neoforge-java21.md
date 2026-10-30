---
status: superseded by ADR-0023 — measured, then the pack was replaced
supersedes: ADR-0018
---

# Start ATM10 To the Sky at `-Xmx7G` on Java 21, and measure before raising it

On 2026-10-25 the operator asked for Minecraft back on this Host, running All the Mods 10 —
To the Sky 2.2.0. ADR-0018's 8G was decided by measuring Homestead, and its inputs changed
the same way ADR-0012's did before it:

| | ADR-0018 (Homestead) | this ADR (ATM10 To the Sky) |
|---|---|---|
| Loader | Fabric 0.18.4 | NeoForge 21.1.250 |
| Minecraft | 1.20.1 | 1.21.1 |
| Java | 17 | **21** — the pack's `startserver.sh` refuses anything older |
| Mods | ~300 | 322 |
| World | normal terrain, pregenerated | a void skyblock (`skyblockbuilder:skyblock`) |

## Why 7G first, not 8G

Homestead measured 9.24 GiB RSS idle under an 8G heap — about 1.2 GiB beside the heap. A
NeoForge pack of this size commonly carries 2–3 GiB of metaspace, code cache and native
allocations instead. 8G plus that lands at or over the 10g `mem_limit`, and a cgroup OOM kill
on the first boot would happen before there was a single number to read.

So ADR-0018's own gate — *above ~9.6 GiB RSS, drop to 7G* — is applied before the first boot
rather than after the first kill. `mem_limit` stays 10g for the reason it always has: it is
what makes the heap decision measurable rather than a quiet slide into swap. The 12 GB Host
also carries Postgres, the web and bot containers and another tenant, and the Zomboid server
(9 GiB cgroup) must stay stopped while this one runs.

What a void world changes: chunk generation is close to free, so the minutes-long worldgen
stalls behind prohibition 1 are rarer — but first boot (NeoForge install, mod construction,
KubeJS recipe reload) still runs past the image's 120s start period, so nothing in ADR-0005
relaxes.

## The gate

After the first boot reaches `Done`, idle, and again after a session with players:

| Reading | Where | Outcome |
|---|---|---|
| `memory.events` `max` | the container's cgroup | must stay **0** |
| `VmRSS`, `RssAnon`, `RssShmem` | `/proc/<java pid>/status` | |
| full GCs | `/data/logs/gc.log` | |

- RSS ≤ 8.6 GiB with `max` = 0 → 8G is affordable; raising to it is the operator's call.
- RSS 8.6–9.6 GiB → stay at 7G.
- RSS > 9.6 GiB, or any `max` event → 6G, and tell the operator the pack is too big for
  this Host as shared.

## Measurements

| When | Players | VmRSS | RssAnon | RssShmem | `max` events | Full GCs |
|---|---|---|---|---|---|---|
| 2026-10-25, first boot idle | 0 | 8.47 GiB | — | — | 0 | — |
| 2026-10-30, after 5 days up, 3–4 players seen | 0 at the time | 8.84 GiB (9,268,212 kB) | 8.80 GiB | 0 | 0 | 0 in `gc.log` |

8.84 GiB sits in the 8.6–9.6 band: **7G was right, and 8G would not have been affordable.**
1.84 GiB of RSS beside a 7G heap is the number this ADR guessed at ("2–3 GiB") and the
first NeoForge figure measured on this Host.

The pack was replaced by The Casket of Reveries on 2026-10-30, before a session with
players was measured. ADR-0023 carries the numbers forward.
