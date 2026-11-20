---
status: proposed — measurement pending
supersedes: ADR-0023
---

# Start Prominence II: Hasturian Era at `-Xmx7G` on Java 17, and measure before raising it

On 2026-11-20 the operator asked for the Game Server to move from The Casket of Reveries to
Prominence II: Hasturian Era 4.1.9, a Fabric RPG pack with a story campaign, class and spell
mods, and a full tech side. The inputs to the heap decision changed again:

| | ADR-0023 (The Casket of Reveries) | this ADR (Prominence II) |
|---|---|---|
| Loader | Forge 47.4.4 | **Fabric 0.20.1** — what Homestead ran on (ADR-0018) |
| Minecraft | 1.20.1 | 1.20.1 |
| Java | 17 | 17 |
| Mods | 159 jars, 700 MB | **373 jars, 800 MB** — Create, AE2, Modern Industrialization, Tech Reborn, Botania, Ad Astra beside the RPG set |
| World | normal terrain | normal terrain — TerraBlender, Regions Unexplored, BetterNether, BetterEnd, When Dungeons Arise |
| Heap helpers | — | Lithium, FerriteCore, ModernFix. **No C2ME**, which Homestead had |

## Why 7G first, not the pack's 8 GB

The pack's server guide asks for 8 GB for 3–4 players plus 1 GB per player after that, and
its launcher's `variables.txt` sets `-Xmx8G -Xms8G`. That is advice for a machine the pack
has to itself, written without this Host's 10g cgroup in view. What has been measured here:

| Pack | Heap | RSS | Beside the heap |
|---|---|---|---|
| Homestead — Fabric 1.20.1, Java 17, 307 mods (ADR-0018) | 8G | 9.24 GiB idle, 9.51 GiB peak in pregen | ~1.2 GiB |
| ATM10 To the Sky — NeoForge 1.21.1, Java 21 (ADR-0022) | 7G | 8.84 GiB idle after 5 days | ~1.8 GiB |
| The Casket of Reveries — Forge 1.20.1, Java 17 (ADR-0023) | 7G | 8.03 GiB at first boot | ~1.0 GiB |

Homestead is the nearest relative — same loader, same Minecraft, same Java — and it ran 8G
inside the gate's "stay" band with almost no headroom, on 66 fewer mods and no tech mods to
speak of. 8G on this pack is not a number that can be defended before it is measured. So the
first boot is at 7G, and `mem_limit` stays 10g for the reason it always has: the cgroup is
where an unaffordable heap shows up as a number.

Two things the last pack taught that apply here directly:

- **Pregeneration is the stress case, not idle.** A full-speed Chunky run took The Casket of
  Reveries' 7G heap to an OOM crash on 2026-11-01; the heap drained once the run paused, so it
  was a save backlog rather than a leak. This pack ships Chunky 1.3.146 itself. Any pregen
  here is paced by heap occupancy, as `pregen-watch.sh` did then, and `deploy/backup.sh` gets
  its pregen guard back before one is started.
- **A known upstream leak.** Pack version 4.0.1 leaked through Copycats+ until an explored
  world was unplayable at 8 GB (upstream issue #553, closed). 4.1.9 ships a later Copycats.
  If RSS climbs across a session on a flat player count, look there first.

## The gate

Unchanged from ADR-0023. After the first boot reaches `Done`, idle, and again after a session
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

If 7G itself proves too small for the pack — full GCs, or `OutOfMemoryError` with a handful
of players — the answer is not `mem_limit`. It is that this pack does not fit beside the
Host's other tenants, and that is the operator's decision to make with the numbers in front
of them.

## Measurements

*Nothing taken yet.* Add the first-boot row, then a row after a session with players, then
change `status` to `accepted`.

| When | Players | VmRSS | RssAnon | RssShmem | `max` events | Full GCs |
|---|---|---|---|---|---|---|
