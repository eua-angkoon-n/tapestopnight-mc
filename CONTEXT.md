# Tapestopnight Minecraft

The RLCraft Dregora game server on tapestopnight.com and the Control Plane that operates it.
This file is a glossary and nothing else — no implementation detail, no decisions. Decisions
live in `docs/adr/`.

## Language

**Modpack**: A named, versioned bundle of Minecraft mods and configs that the server and every
player's client must run identically. Here: RLCraft Dregora v1.1.2b.
_Avoid_: mod, pack, modlist

**Game Server**: The Forge process serving Minecraft on port 25565. One per Modpack.
_Avoid_: server (ambiguous with the box), instance

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
