#!/usr/bin/env python3
"""Bootstrap the pack's server.properties for the one boot before Apply.

ADR-0002 makes Postgres the source of truth and `server.properties` generated
output. This script exists for the gap that opens on every pack change: the
pack ships its own server.properties, and the Game Server boots on it once
before anybody can press Apply.

That first boot is not a formality. It is when the world is generated.

Originally this set only the RCON keys, because a Phase 1 server with no
database had nothing else it needed. A pack change is a different situation:
Homestead shipped `max-tick-time=120000` and `level-name=world`, and both are
wrong here in ways that cost more than a restart.

The Casket of Reveries ships a server.properties again (ATM10 To the Sky did
not), and it is a home server's file: `online-mode=false`, `enable-rcon=false`,
`level-name=world`, `max-tick-time=600000`. Every one of those is wrong here
before the first boot, not merely after it — see `want` below.

If a future pack ships no file at all, this still works: it starts from an
empty file and Minecraft fills in the rest on first boot. Anything that pack's
own launcher would have written (ATM10 To the Sky's wrote `level-type`) has to
be added to `want` for that pack, because `level-type` cannot be fixed after
the world exists.

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
    "level-name": os.environ.get("LEVEL_NAME", "reveries"),

    # ── Authentication, which this pack ships switched OFF ────────────────
    #
    # The pack's file says online-mode=false. On the first boot that means
    # every player's UUID is derived from the name they typed, so anyone can
    # join as an operator's name, and every UUID the Player Link and the
    # Milestone scan record (ADR-0016, ADR-0020) is one that changes the day
    # it is switched back on. It has to be right before anyone joins.
    "online-mode": "true",
}

# Used ONLY when the pack ships no server.properties. The Casket of Reveries
# does ship one, so this is empty; `want` above is applied on top either way.
PACK_DEFAULTS = []

if os.path.exists(path):
    with open(path) as fh:
        lines = fh.read().splitlines()
else:
    print("no {} - starting from an empty file".format(path))
    lines = list(PACK_DEFAULTS)

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
print("  max-tick-time=-1, online-mode=true and level-name={} matter before the first boot".format(want["level-name"]))
