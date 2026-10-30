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

It is The Casket of Reveries 2.2.9.8's, taken verbatim from
`Casket of Reveries 2.2.9.8 Server.zip` on 2026-10-30 (CRLF converted to LF,
nothing else). This pack ships the file again; ATM10 To the Sky, the pack
before it, did not, and its fixture had to be captured from the Host after a
first boot.

It is a 1.20.1 file and carries two keys 1.20.1 no longer reads
(`max-build-height`, `snooper-enabled`). They stay: the file is the pack's, and
the renderer passing an unknown key through untouched is part of what the
check verifies.

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

`max-tick-time`, `enable-rcon`, `level-name` and `online-mode` are overridden at seed time, for
reasons that are about this Host rather than about the pack. They live in
`db/seed/deployment-overrides.ts` with the reasoning attached, and the generated
SQL marks each one `-- OVERRIDDEN`. This file stays verbatim.
