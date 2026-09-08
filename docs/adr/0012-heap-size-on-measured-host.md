---
status: accepted
supersedes: ADR-0011
---

# Run at `-Xmx7G` on the measured 12 GB Host

> Originally decided as 8G. Revised to 7G after booting it and measuring — see
> "Revised after measurement" below. The 8G arithmetic is kept because it is why
> 7G is the number.

> **User override.** Claude recommended `-Xmx6G` for live play (the value the pack author
> tested) with 8G reserved for the pre-generation pass only. The user chose 8G at all times.
> Their call, and final. What follows is the honest arithmetic, the risk that remains, and the
> mitigations that make the choice defensible.

ADR-0011 committed to `-Xmx4G` to survive on an 8 GB Host. That was planned against a figure
given before anyone could log in. **Phase 0 measured the Host and it is not 8 GB.** ADR-0011's
justification is gone, so it is superseded rather than quietly edited — the record should show
a decision made on a wrong premise and corrected, not a history where every call was right.

## What the Host actually is

| | Measured |
|---|---|
| RAM | **11,960 MB total, 11,017 MB available** |
| CPU | 6 vCPU, AMD EPYC |
| Disk | 193 GB, **189 GB free** (3% used) |
| OS | Ubuntu 24.04.4 LTS, kernel 6.8 |
| Swap | none; `vm.swappiness=60` |

The ledger system — the unknown ADR-0011 called "the deciding number", with a 1.5 GB ceiling —
measures **~82 MB**: `family-ledger-app-1` at 47 MB and `family-ledger-db-1`
(`postgres:16-alpine`) at 35 MB. Eighteen times under the ceiling.

## Revised after measurement: `-Xmx7G`

The 8G configuration was actually built and booted, and then measured rather
than argued about. With **zero players connected**:

```
container : 9.041 GiB / 10 GiB   (90.4% of mem_limit)
host      : 1,951 MB available
non-heap  : 9.04 - 8.00 = 1.04 GiB
```

Non-heap already sat at 1.04 GiB at idle — the low end of the 1–1.5 GB this
ADR predicted. Metaspace, code cache and G1 remembered sets all grow once
players connect and more mod code paths execute, so RSS heads toward ~9.5 GiB
against a 10 GB cgroup limit. Roughly 500 MB of margin, and exceeding it means
the cgroup OOM-kills the server **with players online**.

Raising `mem_limit` is not a way out. The remaining phases need ~650 MB
(Postgres, Next.js, the bot), the OS ~700 MB and ledger ~82 MB. A 10.5 GB limit
totals ~11.93 GB of the Host's 11.96 GB — leaving nothing for the page cache
that chunk I/O depends on.

**So the heap is 7G**, keeping `mem_limit: 10g`:

| heap | measured / projected RSS | cgroup headroom | Host free after all phases |
|---|---|---|---|
| 8G | **9.04 GiB measured**, ~9.5 under load | ~0.5 GB | ~1.3 GB |
| **7G (chosen)** | ~8.0–8.5 GiB | ~1.5 GB | ~2.3 GB |
| 6G | ~7.0–7.5 GiB | ~2.5 GB | ~3.3 GB |

This is the user's call again, taken on measurement rather than prediction. The
Java 8 single-threaded-full-GC risk below still applies, just to a smaller
heap, and every mitigation stays in force.

### A prerequisite the measurement exposed

GC logging silently did nothing on the first boot. The flags were all correctly
applied — verified in `/proc/<pid>/cmdline` — but Java 8 opens the GC log at JVM
startup, and the log emitted:

```
OpenJDK 64-Bit Server VM warning: Cannot open file /data/logs/gc.log
due to No such file or directory
```

The pack ships no `logs/` directory, and log4j creates it about 55 seconds into
boot — long after the JVM needed it. So the very measurement this ADR relies on
was absent, and nothing failed loudly to say so. `deploy/prepare-host.sh` now
creates `logs/` (owned by uid 1000) before the container starts.

**The lesson worth keeping: a mitigation that reports nothing is
indistinguishable from a mitigation that is working.** ADR-0010 made the same
argument for failing closed when `gitleaks` is missing.

## The budget at `-Xmx8G`

JVM resident memory is heap *plus* metaspace, code cache, GC structures, thread stacks and
direct buffers. 215 mods put metaspace alone at 300–500 MB:

| | RAM |
|---|---|
| Heap | 8,192 MB |
| Metaspace (215 mods) | ~400 MB |
| Code cache | ~250 MB |
| G1 structures (remembered sets, marking bitmaps) | ~400–800 MB |
| Thread stacks + direct buffers | ~230 MB |
| **Forge JVM RSS** | **~9,400–9,900 MB** |
| Our Postgres (`shared_buffers=128MB`) | ~300 MB |
| Next.js + Discord bot | ~350 MB |
| **Total** | **~10,050–10,550 MB of 11,017 available** |

**Remaining slack: ~470–970 MB**, and Linux page cache competes for it. At 6G the slack would
have been ~2.9 GB.

## The risk we are accepting

**Java 8's G1 has no parallel full GC.** Parallel full collection arrived in JDK 10
(JEP 307), and ADR-0005 pins this modpack to Java 8 because Forge 14.23.5 requires it. So a
full GC runs **single-threaded**, and its duration scales with heap size with no help from the
other five cores. An 8 GB heap therefore has a worst-case pause roughly a third longer than a
6 GB one, and at this size a full GC can run long enough that players time out and drop.

**Page cache is squeezed.** `-Xms` equals `-Xmx` per the readme, so 8 GB is committed at
startup. A Minecraft server reads and writes chunk files constantly — most of all while OTG
generates new terrain — and page cache is what makes that I/O cheap.

**More heap is not the fix for our actual bottleneck.** For roughly ten players the limit is
CPU during chunk generation, not heap space. A larger heap mainly makes collections rarer and
heavier.

## Mitigations (these are what make 8G defensible, not optional extras)

**Use Aikar's flag set, not the readme's basic line.** The readme itself points at Aikar's
script generator. Two of its flags target this exact risk:

- **`-XX:InitiatingHeapOccupancyPercent=15`** — starts concurrent marking far earlier than the
  default 45%, so G1 reclaims incrementally instead of falling back to a full GC. This is the
  single most important flag for avoiding the pause we are worried about, and the readme's
  basic line omits it.
- **`-XX:+AlwaysPreTouch`** — touches all 8 GB at startup so the heap is committed and resident
  and cannot later be paged out.

Plus `-XX:+ParallelRefProcEnabled`, `-XX:MaxGCPauseMillis=200`, `-XX:+UnlockExperimentalVMOptions`,
`-XX:+DisableExplicitGC`, `-XX:G1NewSizePercent=30`, `-XX:G1MaxNewSizePercent=40`,
`-XX:G1HeapRegionSize=8M`, `-XX:G1ReservePercent=20`, `-XX:G1HeapWastePercent=5`,
`-XX:G1MixedGCLiveThresholdPercent=90`, `-XX:G1RSetUpdatingPauseTimePercent=5`,
`-XX:SurvivorRatio=32`, `-XX:+PerfDisableSharedMem`, `-XX:MaxTenuringThreshold=1`.

**Measure the pauses instead of arguing about them.** GC logging is on from day one
(`-Xloggc:`, `-XX:+PrintGCDetails`, `-XX:+PrintGCDateStamps`, log rotation). If full-GC pauses
turn out to be short in practice, this ADR was cautious for nothing and that is worth knowing.
If they exceed a few seconds, we have evidence to drop to 6G rather than a hunch.

**Add swap as a real safety net, no longer optional.** A 4 GB swap file with
`vm.swappiness=1`. With `AlwaysPreTouch` keeping the JVM resident, swap absorbs a spike in a
*non-JVM* process instead of the kernel invoking the OOM killer — which, as ADR-0010 notes,
picks the largest consumer, i.e. the game server.

**Protect the container from the OOM killer.** Set `oom_score_adj: -500` on the Minecraft
service so the kernel prefers almost anything else, and keep `mem_limit` above expected RSS
(`10g`) so the cgroup bounds it without strangling it.

## What this reverses from ADR-0011

- `max-players=8` → back to the pack's shipped value. No artificial cap.
- The concession "accept GC spikes and lower TPS as normal" → not accepted; we tune and measure.
- The pregen workaround of stopping the web app and bot to borrow heap → unnecessary. Pregen
  runs at the normal 8G with everything else up.
- The warning on the `max-players` config key about a 4 GB heap → drop it.

## What survives from ADR-0011

The arithmetic method above, and its final caution: **swapping a JVM heap destroys TPS**, so
the JVM must never be the thing that swaps. `AlwaysPreTouch` plus `vm.swappiness=1` is how we
hold that line while still having swap.
