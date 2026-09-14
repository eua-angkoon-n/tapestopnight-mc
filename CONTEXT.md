# Tapestopnight Minecraft

The Homestead game server on tapestopnight.com and the Control Plane that operates it.
This file is a glossary and nothing else — no implementation detail, no decisions. Decisions
live in `docs/adr/`.

## Language

**Modpack**: A named, versioned bundle of Minecraft mods and configs that the server and every
player's client must run identically. Here: Homestead 1.3.7 — Minecraft 1.20.1 on Fabric.
_Avoid_: mod, pack, modlist

**Game Server**: The Minecraft server process on port 25565, running under the Modpack's mod
loader. One per Modpack. Say "the Game Server", not the loader's name — it was Forge until
Homestead and is Fabric now, and the word changing is precisely why this entry avoids it.
_Avoid_: server (ambiguous with the box), instance, Forge, Fabric

**Host**: The Contabo VPS itself (`217.216.111.122`), which runs the Game Server, the Control
Plane, and the pre-existing ledger system.
_Avoid_: server, VPS, machine

**Control Plane**: The web app, the Discord bot, and the Postgres database that together
observe and mutate the Game Server. Never the Game Server itself.
_Avoid_: dashboard, panel, backend

**Desired Config**: The authoritative configuration held in Postgres.
_Avoid_: settings, properties

**Rendered Config**: The `server.properties` and `server-icon.png` files generated from the
Desired Config onto disk. Disposable output, never edited by hand.
_Avoid_: config file, live config

**Apply**: The action that renders the Desired Config to disk and restarts the Game Server.
The only way a config change reaches players.
_Avoid_: save, deploy, sync

**Edit Tier**: The `LOCKED` / `GUARDED` / `FREE` classification on each config key deciding
whether and how the admin UI may change it. See ADR-0003.

**Status Poller**: The single background process that probes the Game Server over Server List
Ping and caches the result. The only thing that ever probes the Game Server for status.
_Avoid_: healthcheck (that word is reserved for Docker's, which we deliberately disable)

**Server Icon**: The source image an admin uploads. The 64×64 PNG derived from it for the
Minecraft protocol is a Rendered Config artifact, not the Server Icon itself.

**Chat Bridge**: The one path by which messages cross between the Game Server, the website and
Discord. Every message becomes a row; the bot is the only process that moves rows onto the Game
Server. See ADR-0015.
_Avoid_: relay, webhook, integration

**Milestone**: Something a player did that is worth announcing — read from the world's
advancement files, or from the vanilla statistics file for something that ships no advancement.
Curated: only what `notable_milestone` allows is recorded at all.
An advancement is what the game writes; a Milestone is one we chose to announce.
_Avoid_: achievement (nothing is called that here)

Note for anyone reading old commits: until Homestead this entry said the opposite — advancements
were unusable because Dregora unloaded the advancement system to save memory, so Milestones came
from Better Questing instead. Both that mod and that constraint are gone.

**Player Link**: The recorded pairing of one Discord account with one Minecraft name. Made by
address match or by a typed code, and required before anyone may speak from the website.
_Avoid_: verification, whitelist, account
