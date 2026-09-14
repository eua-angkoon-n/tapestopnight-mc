#!/usr/bin/env python3
"""Bootstrap the pack's server.properties for the one boot before Apply.

ADR-0002 makes Postgres the source of truth and `server.properties` generated
output. This script exists for the gap that opens on every pack change: the
pack ships its own server.properties, and the Game Server boots on it once
before anybody can press Apply.

That first boot is not a formality. It is when the world is generated.

Originally this set only the RCON keys, because a Phase 1 server with no
database had nothing else it needed. A pack change is a different situation:
Homestead ships `max-tick-time=120000` and `level-name=world`, and both are
wrong here in ways that cost more than a restart.

Keep the list below in step with `db/seed/deployment-overrides.ts`, which is
the reviewed source for the same decisions. They are stated twice on purpose —
that file is TypeScript and there is no Node on the Host, and this script runs
exactly once per pack, at the point where nothing else can speak for these
values yet.
"""
import os
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/srv/mc/pack/server.properties"
pw = os.environ.get("RCON_PASSWORD")
if not pw:
    sys.exit("RCON_PASSWORD not set in the environment")

want = {
    # ── RCON: without this the Control Plane cannot speak at all ──────────
    "enable-rcon": "true",
    "rcon.port": "25575",
    "rcon.password": pw,

    # ── The watchdog, which is the dangerous one ──────────────────────────
    #
    # The pack ships the vanilla two-minute default. Generating chunks for a
    # 307-mod pack blocks the main thread for longer than that, and the
    # watchdog's response is to kill the server — during worldgen, which is
    # when region files are half-written. Waiting for Apply to fix it means
    # the one boot it is wrong for is the one that matters.
    # → CLAUDE.md prohibition 1, ADR-0005
    "max-tick-time": "-1",

    # ── The world's name, which has to be right the FIRST time ────────────
    #
    # Not a cosmetic default. The server creates the world directory on first
    # boot from whatever this says; booting on the pack's `world` and fixing it
    # afterwards generates a second world and orphans the first, throwing away
    # the whole first generation pass. It also has to agree with MC_WORLD_DIR
    # in docker-compose.yml and LEVEL_NAME in backup.sh.
    "level-name": os.environ.get("LEVEL_NAME", "Homestead"),
}

with open(path) as fh:
    lines = fh.read().splitlines()

out, seen = [], set()
for line in lines:
    if line.startswith("#") or "=" not in line:
        out.append(line)
        continue
    key = line.split("=", 1)[0].strip()
    if key in want:
        out.append("{}={}".format(key, want[key]))
        seen.add(key)
    else:
        out.append(line)

for key, value in want.items():
    if key not in seen:
        out.append("{}={}".format(key, value))

header = [
    "# BOOTSTRAP - not yet authoritative.",
    "# Seeded from the pack's own server.properties so the server can boot once",
    "# before Apply has rendered the Desired Config. This file is RENDERED from",
    "# the database per ADR-0002, and anything edited here is lost on the next",
    "# Apply. Only the keys that must be correct for the FIRST boot are set here.",
]

with open(path, "w") as fh:
    fh.write("\n".join(header + out) + "\n")

print("bootstrap keys set: " + ", ".join(sorted(want)))
print("  max-tick-time=-1 and level-name={} matter before the first worldgen".format(want["level-name"]))
