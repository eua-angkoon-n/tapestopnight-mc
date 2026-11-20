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

It is Prominence II: Hasturian Era 4.1.9's — and, like ATM10 To the Sky's, it
is **not** inside the server pack zip, because this pack ships no
`server.properties` at all. Unlike ATM10's, its launcher (`start.sh`) writes
none either, only `eula.txt`. What the pack alone produces is therefore
Minecraft 1.20.1's own default file, and that is what this is: 56 keys, written
out on 2026-11-20 **before** the first boot, from the 1.20.1 defaults.

⚠ That makes it the one fixture here that was written rather than captured.
After the first boot on the Host, diff it against the file the server actually
wrote (with `rcon.password` blanked and the bootstrap overrides below reverted)
and replace it if a single line differs — a Fabric mod is allowed to add a key
or change a default, and this file must be the server's, not a recollection.

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

## Four values here are not what gets deployed

`max-tick-time`, `enable-rcon`, `level-name` and `allow-flight` are overridden at seed time, for
reasons that are about this Host rather than about the pack. They live in
`db/seed/deployment-overrides.ts` with the reasoning attached, and the generated
SQL marks each one `-- OVERRIDDEN`. This file stays verbatim.
