---
status: superseded by ADR-0012
---

> **SUPERSEDED.** This ADR was written against a stated 8 GB Host. Phase 0 measured
> the Host at **11,960 MB with 11,017 MB available**, and the ledger system at ~82 MB
> rather than the feared 1.5 GB. The premise below is false. See
> [ADR-0012](./0012-8gb-heap-on-measured-12gb-host.md), which runs `-Xmx8G`. Kept unedited
> so the corrected premise stays visible.

# Run at `-Xmx4G` on an 8 GB Host, against the modpack's `6G` recommendation

`SERVER README OR DIE.txt` prescribes `-Xmx6G -Xms6G`. **We deliberately run 4 GB.** A future
reader will see this contradiction, assume it is a mistake, and "fix" it — which on an 8 GB
box would push JVM resident memory to ~7–7.5 GB and start OOM-killing things. Hence this record.

**The constraint:** the Host is 8 GB and also runs the pre-existing ledger system. JVM RSS is
heap plus metaspace, code cache, GC structures and thread stacks; 215 mods put metaspace alone
at 300–500 MB, so budget ~1–1.5 GB above heap. At `-Xmx6G` that is ~7–7.5 GB, which leaves
nothing for the OS, Docker, Postgres, the web app, the bot, or ledger. At `-Xmx4G` it is
~5.0–5.5 GB, which fits — with no slack.

**What we accepted in exchange:**

- `max-players` reduced from the shipped 20 to **8**. This is a FREE-tier key (ADR-0003), so
  the admin UI can change it — and a future admin raising it back to 20 on 4 GB heap is a
  foreseeable way to destabilise the server. The key's UI description must say so.
- GC pressure spikes, and therefore TPS dips, when players explore unpregenerated terrain and
  OTG generates chunks. This is why pre-generation is *more* important here, not less.
- `view-distance` stays at **10** and is not lowered to save memory. The readme is explicit
  that 8 or 6 causes mob spawn/despawn bugs, so that saving has a gameplay cost we decline.

**Pregen runs at a temporarily raised heap.** Pre-generation is the most memory-hungry
operation the server ever performs, it happens once before launch, with no players connected
and nothing else competing. So we stop the web app and bot, raise the container to `-Xmx6G`
for the pregen run only, and drop back to `-Xmx4G` for live operation. This buys the headroom
where it is actually needed without paying for RAM permanently.

**The condition that invalidates this ADR:** if the ledger system turns out to use more than
roughly **1.5 GB**, 8 GB does not work and must be reported rather than forced — Phase 0
checks this before anything is built. Swap is not a rescue: swapping a JVM heap destroys TPS.
A small swap file with low `vm.swappiness` is a safety net for the *other* processes only.
