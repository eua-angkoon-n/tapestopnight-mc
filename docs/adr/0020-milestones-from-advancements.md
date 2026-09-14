---
status: accepted
supersedes: the milestone half of ADR-0015
---

# Milestones come from the world's advancement files

ADR-0015 decided that the Chat Bridge tails the log and writes over RCON, and that Milestones
come from Better Questing rather than from advancements. **The first half stands unchanged.**
The second is reversed here, because the constraint that forced it is gone.

## Why ADR-0015 could not use advancements

Dregora shipped `config/fermiummixins.cfg` with `"Nuke Advancements (Vanilla)"=true`, which
stopped the advancement system loading at all to save memory. `DregoraRL/advancements/<uuid>.json`
on the Host was `{}`, and `announceAdvancements=true` in the gamerules was announcing nothing.
Any design that waited for "X has made the advancement [Y]" in the log would have waited
forever. Better Questing's `QuestProgress.json` plus the vanilla statistics file were the only
sources that existed.

## Why that reverses

Homestead disables nothing of the sort, and Better Questing is not in it. Concretely, three
things in the old reader had stopped being true rather than stopped working:

- `questCompletions()` parsed Better Questing's NBT-flavoured JSON. The mod is absent, so the
  file is absent.
- `killCounts()` read `stat.killEntity.<id>` keys. **1.13 replaced the statistics file
  wholesale** with `{"stats": {"minecraft:killed": {...}}}`. The old reader did not throw on
  the new shape — it returned an empty object. A milestone reader that silently finds nothing
  is worse than one that crashes, and this is the specific failure the migration had to catch.
- `nameCache()` read Better Questing's `NameCache.json`. The server's own `usercache.json`
  replaces it, and lives beside the jar rather than inside the world.

## The decision

Read `<world>/advancements/<uuid>.json`, keeping entries where `done` is exactly `true`.
Keep the statistics file as the second source for anything the pack ships no advancement for.
Resolve names through `usercache.json`.

`notable_milestone.kind` gains `advancement` alongside the existing `kill`. It is a `text`
column rather than an enum, so this needed no migration.

## Why files, and not the log line the Chat Bridge is already reading

1.20.1 does print `X has made the advancement [Y]`, and the bridge is already tailing that log,
so reading it there looks free. It is worse, and the reason is the same one that makes this a
different problem from chat:

**A log line is an event; the advancement file is state.** A chat message that nobody was
listening for is genuinely gone, and that is acceptable — chat is ephemeral. A milestone is
not. If the bot is restarting, or the log has just rotated, or the container was down for ten
minutes during a deploy, a log-driven reader loses the announcement permanently and nothing
anywhere says so. A file-driven scan that runs late still sees everything, and
`player_milestone` already exists to make a repeated read idempotent.

Two smaller consequences fall out of it:

- Nothing depends on the exact shape of a log line, so no fixture has to be captured from the
  Host before the reader can be written or tested. The three phrasings — *made the
  advancement*, *completed the challenge*, *reached the goal* — stop being a parsing problem.
- Nothing depends on `announceAdvancements` being on.

Recipe unlocks (`minecraft:recipes/...`) are excluded at the reader. Vanilla writes one per
recipe a player has unlocked — hundreds of them, none of which anyone would call an
achievement. They could not reach the allowlist by accident anyway; skipping them keeps the
scan off a list two orders of magnitude longer than the interesting one.

## The allowlist is still the only decision

Unchanged from ADR-0015 and worth restating, because the numbers got bigger rather than
smaller. Vanilla 1.20.1 has over a hundred advancements before Homestead's datapacks add more.
The `notable_milestone` allowlist is applied **at scan time**, not at announce time, so only
notable things are ever recorded — which is also what makes adding a row later work: an
advancement added to the allowlist next month is announced the next time the scan sees it, for
players who finished it weeks ago, because it was never recorded as seen.

`db/seed/0002-milestones.sql` is seeded with vanilla ids only, weighted toward farming, taming
and building rather than boss kills — the fights were what Dregora was about; this pack is not.
The pack's own advancement ids are **not** in it yet and must be read off the running server
rather than guessed, which is the same standard the Dregora file set for itself.
