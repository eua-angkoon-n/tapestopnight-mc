---
status: accepted
supersedes: ADR-0012
---

# Run at `-Xmx8G` on Java 17, with a measurement gate instead of a measurement

ADR-0012 settled on `-Xmx7G`, and it settled it honestly: it booted the server, read the GC
log, and revised its own 8G recommendation down after seeing 9.04 GiB of RSS with zero
players. That is the right way to pick a heap size, and it is exactly why its number cannot
simply be carried forward.

**Every input to it changed.** The pack moved from RLCraft Dregora to Homestead, Forge to
Fabric, Minecraft 1.12.2 to 1.20.1, and — the part that matters most here — Java 8 to Java 17.
ADR-0012's central argument is a sentence about a runtime that no longer runs:

> Java 8's G1 has no parallel full GC … ADR-0005 pins this modpack to Java 8 because
> Forge 14.23.5 requires it.

JDK 10 gave G1 a parallel full GC. The single-threaded-full-GC risk that made a large heap
frightening on this Host is not present on Java 17.

## Java 17, not 21

The first draft of this ADR said 21, on the reasoning that it is the current LTS and that
Fabric 1.20.1 runs on it. The pack disagrees, and the pack wins: Homestead's own
`variables.txt` ships `RECOMMENDED_JAVA_VERSION=17`.

21 would very probably work. "Very probably" is how a 307-mod pack produces a mixin failure
that names a mod rather than the JRE, at which point the person debugging is reading a stack
trace about a farming mod and has no reason to suspect the runtime. The cost of matching the
pack's number is nothing; the cost of not matching it is paid at the worst possible moment.

## The decision

`MEMORY=8G`, chosen by the operator, with `mem_limit` left at `10g`.

This is a decision made **without** a measurement, which is unusual for this project and is
stated plainly rather than dressed up. What follows is the case for it, the case against, and
the gate that closes the gap.

## Why 8G is defensible

- **The two numbers the pack gives do not agree, and both are above nothing.** The wiki's
  server-pack page says to allocate 8–12 GB, and more again for 3–5+ players. The server pack's
  own `variables.txt` ships `JAVA_ARGS="-Xmx5G -Xms5G"`. Read together, the author's tested
  floor is 5G and their comfortable figure is 8–12 GB, which puts 8G at the bottom of
  "comfortable" rather than at the top of "possible".

  This is worth stating plainly because it **reverses the shape of the risk** this ADR was
  drafted under. The plan that produced it treated 8G as straining against a pack that wanted
  12; on the author's own default of 5G, 8G is 60% more than the pack is built to need.
- **The runtime is more frugal.** Fabric with Lithium, FerriteCore and C2ME holds
  substantially less per chunk than Forge 1.12.2 did, and 1.20.1's own chunk storage is
  denser than 1.12.2's. The 9.04 GiB figure was measured against the worst case of both.
- **The mod count went down, not up.** The server pack carries **307** jars, not the 374 the
  CurseForge listing quotes — that number counts the client pack, and Fabric skips
  `"environment": "client"` mods on a dedicated server anyway. Dregora ran 206 Forge mods, so
  this is more, but by half as much as the headline figure suggested.
- **Java 17 reclaims better.** Parallel full GC, region-based reclamation that copes with a
  larger heap, and string deduplication that Java 8 did not have.

## Why it is still a risk

- **The Host has 12 GB and does not own all of it.** ADR-0012's arithmetic on that point is
  unchanged and still correct: the JVM's RSS is heap plus metaspace plus G1's own structures
  plus direct buffers, and at 8G that came to 9.04 GiB on the previous stack.
- **307 mods is still more than 206.** Mod count drives metaspace and static data, and
  Homestead has more of both than Dregora did, in the one area where a newer JDK does not help.
- **We are guessing which of those wins.** Every argument above is directional. Not one of them
  is a measurement of this pack on this Host, which is the only thing that settles it.

## The gate

`mem_limit` stays at `10g` **specifically so that this decision is measurable**. Raising it to
make the heap fit would convert a question with an answer into a slow leak of the Host's spare
memory, and the other tenant on this machine would pay for it.

After the server is up and idle — not during first-boot chunk generation, which is not
representative:

```bash
docker stats --no-stream tapestopnight-mc
```

| RSS | Verdict |
|---|---|
| ≤ 9.0 GiB | 8G confirmed. Record the number here and this ADR is finished. |
| 9.0 – 9.6 GiB | Passes, with no headroom. Record it as the ceiling; do not raise `max-players` without watching TPS. |
| > 9.6 GiB | **Drop to 7G and restart.** Do not raise `mem_limit`. |

The threshold is deliberately a back-out rather than an alarm, in the same shape ADR-0017 used
for the voice chat jar. An OOM kill on this Host does not degrade the Game Server, it selects
it: `oom_score_adj: -500` biases the kernel away, but the JVM is still the largest process by a
wide margin, and every connected player is dropped at once.

⚠ **This table is not yet filled in.** Until somebody writes a measured number into it, treat
`-Xmx8G` as provisional, and treat any swap-in on this Host as the heap question first.

If it does come back high, note that dropping to 7G is not the only move available: the pack
runs at 5G by its author's own default, so there is more room below than ADR-0012's Dregora
numbers would suggest.

## What carries forward unchanged

- **`USE_AIKAR_FLAGS=true` is mitigation, not decoration.** Under `MEMORY` of 12g or less it
  selects Aikar's standard branch: `InitiatingHeapOccupancyPercent=15`, so concurrent marking
  starts early and G1 reclaims incrementally instead of falling back to a full collection, and
  `-XX:+AlwaysPreTouch`, so the heap stays resident and is never the thing that swaps.
- **GC logging stays on**, because "is it the heap?" should be answerable from a file rather
  than from an argument.

## What had to change in the GC flags, and why it would have been fatal

The flags themselves could not be carried over:

```
-Xloggc:/data/logs/gc.log  -XX:+PrintGCDetails  -XX:+PrintGCDateStamps
-XX:+PrintGCApplicationStoppedTime  -XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=5  -XX:GCLogFileSize=10M
```

Every one of these was **removed in JDK 16**, not deprecated — so they are gone on 17 just as
surely as on 21, and the choice between those two JDKs does not soften this at all. A JVM given
a removed `-XX` option prints `Unrecognized VM option` and exits. Left in place, the container would have
died in under a second on every start, with no Minecraft output at all to explain it — an
error that reads as "the pack is broken" and is not.

The replacement is one flag in unified-logging form, in `deploy/docker-compose.yml`:

```
-Xlog:gc*,safepoint:file=/data/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=10M
```

`safepoint` is what replaces `PrintGCApplicationStoppedTime`, and it remains the number that
matters: total time the world was frozen, which is what a player actually experiences.

`deploy/prepare-host.sh` is still required. The reason is unchanged — the JVM opens the log at
startup and, if `/data/logs` does not exist yet, carries on with no GC logging at all rather
than failing. The pack ships no `logs/` directory and log4j creates it far too late.

## ADR-0012 is kept unedited

Same reasoning ADR-0012 applied to ADR-0011. Its measurements were correct for the stack it
measured, and the record should show a number that was right and then stopped being right,
rather than one that was quietly overwritten when the ground moved.
