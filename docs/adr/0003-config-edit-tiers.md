# Config keys carry an Edit Tier; unknown keys default to LOCKED

ADR-0002 lets the web UI rewrite `server.properties`, which lets it destroy the world —
changing `level-name` orphans the world and loses all player progress and pre-generation. So
every key carries a tier:

| Tier | Keys |
|---|---|
| **LOCKED** | `level-name`, `level-type`, `max-tick-time`, `server-port`, `enable-rcon`, `rcon.password`, `allow-flight`, `enable-command-block`, `max-world-size` |
| **GUARDED** | `difficulty`, `pvp`, `online-mode`, `view-distance`, `spawn-protection`, `white-list` |
| **FREE** | `motd`, Server Icon, `max-players`, `player-idle-timeout` |

Unknown or newly-introduced keys **default to LOCKED** — fail-safe, so adding a key can never
silently open a hole.

**Why LOCKED keys are shown rather than hidden:** an admin who can see *that* `level-name` is
locked and *why* won't go hunting for it over SSH. Hiding keys causes exactly the hand-editing
ADR-0002 forbids. How the tiers are expressed in the UI is ADR-0007.
