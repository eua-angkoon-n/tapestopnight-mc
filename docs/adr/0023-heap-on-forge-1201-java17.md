---
status: proposed — measurement pending
supersedes: ADR-0022
---

# Start The Casket of Reveries at `-Xmx7G` on Java 17, and measure before raising it

On 2026-10-30 the operator asked for the Game Server to move from ATM10 To the Sky to
NightfallCraft: The Casket of Reveries 2.2.9.8, a souls-like RPG pack built on Epic Fight.
The inputs to the heap decision changed again:

| | ADR-0022 (ATM10 To the Sky) | this ADR (The Casket of Reveries) |
|---|---|---|
| Loader | NeoForge 21.1.250 | **Forge 47.4.4** |
| Minecraft | 1.21.1 | **1.20.1** |
| Java | 21 | **17** — the Forge 47 line's runtime, and what Homestead ran on |
| Mods | 322 | 159, but 700 MB of jars — Cataclysm, Epic Fight and its add-ons, Mowzie's Mobs and Alex's Mobs carry large models and animations |
| World | a void skyblock | **normal terrain** — Tectonic, TerraBlender, Oh The Biomes We've Gone, When Dungeons Arise |

## Why 7G first, not the pack's "8GB+"

The pack's page asks for 8 GB or more. That is advice for a home PC, written without this
Host's 10g cgroup in view. What has been measured here:

| Pack | Heap | Idle RSS | Beside the heap |
|---|---|---|---|
| Homestead — Fabric 1.20.1, Java 17 (ADR-0018) | 8G | 9.24 GiB | ~1.2 GiB |
| ATM10 To the Sky — NeoForge 1.21.1, Java 21 (ADR-0022) | 7G | 8.84 GiB | ~1.8 GiB |

Forge on 1.20.1 with a mod set this heavy in models is not obviously lighter than either. 8G
plus 1.2–1.8 GiB lands at 9.2–9.8 GiB of a 10g limit before a player connects, which is the
gate's own "drop a size" band. So the first boot is at 7G, and `mem_limit` stays 10g for the
reason it always has.

What normal terrain changes: worldgen stalls are back at full strength, so prohibition 1
(`max-tick-time=-1`, no healthcheck, 10m stop grace) matters more than it did on a void world,
not less. The pack itself ships `max-tick-time=600000`; the deployment override replaces it.

## The gate

Unchanged from ADR-0022. After the first boot reaches `Done`, idle, and again after a session
with players exploring new terrain:

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

*Not yet taken.* Fill this table in, then change `status` to `accepted`.

| When | Players | VmRSS | RssAnon | RssShmem | `max` events | Full GCs |
|---|---|---|---|---|---|---|
| | | | | | | |
