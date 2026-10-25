# Fixtures

`pack-server.properties` is the modpack's own `server.properties`, exactly as
shipped inside the server pack zip.

It is committed even though ADR-0009 keeps vendor payload out of git, because
it is not payload — it is the **expected output** that CI checks the renderer
against. Under a kilobyte of text, and without it the ADR-0002 faithfulness
check cannot run anywhere but on a machine that happens to have the pack
unpacked.

Do not edit it. If the pack is upgraded, replace it wholesale from the new zip
and expect the render check to tell you what changed.

It is ATM10 To the Sky 2.2.0's — 61 keys — and, unlike every pack before it,
it is **not** inside the server pack zip, because that pack ships no
`server.properties` at all. Its `startserver.sh` writes four keys into a fresh
file (`allow-flight`, `motd`, `max-tick-time=180000`,
`level-type=skyblockbuilder\:skyblock`) and Minecraft 1.21.1 fills in the rest
on first boot.

So this file was captured from the Host after the first boot on 2026-10-25,
with `rcon.password` blanked and the three bootstrap overrides below reverted
to what the pack alone would have produced (`enable-rcon=false`,
`max-tick-time=180000`, `level-name=world`). That makes it the pack's file in
every respect that matters, and keeps `deployment-overrides.ts` the only place
our values come from.

## One key is deliberately not round-tripped

`rcon.password` is in `SECRET_KEYS`, so the renderer never emits it from a
stored row and takes the value from the environment instead (ADR-0002). It
therefore cannot survive a round trip by construction, and `render-check.ts`
excludes it explicitly rather than being "fixed" by deleting the line from this
file — which would quietly end the guarantee that this is the pack's file
verbatim. The check asserts the key's *absence* from the rendered output
separately, which is the stricter question.

Dregora's file did not contain `rcon.password` at all, which is the only reason
the check passed without that carve-out until now.

## Three values here are not what gets deployed

`max-tick-time`, `enable-rcon` and `level-name` are overridden at seed time, for
reasons that are about this Host rather than about the pack. They live in
`db/seed/deployment-overrides.ts` with the reasoning attached, and the generated
SQL marks each one `-- OVERRIDDEN`. This file stays verbatim.
