# Fixtures

`pack-server.properties` is the modpack's own `server.properties`, exactly as
shipped inside `RLCraft Dregora v1.1.2b - server pack.zip`.

It is committed even though ADR-0009 keeps vendor payload out of git, because
it is not payload — it is the **expected output** that CI checks the renderer
against. 870 bytes of text, and without it the ADR-0002 faithfulness check
cannot run anywhere but on a machine that happens to have the pack unpacked.

Do not edit it. If the pack is upgraded, replace it wholesale from the new zip
and expect the render check to tell you what changed.
