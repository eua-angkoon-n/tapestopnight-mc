#!/usr/bin/env python3
"""Phase 1 bootstrap only: enable RCON in the pack's server.properties.

From Phase 3 the file is rendered from Postgres (ADR-0002) and this script
becomes dead weight. It exists because the server has to boot once before
there is a database to render from.
"""
import os
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/srv/mc/pack/server.properties"
pw = os.environ.get("RCON_PASSWORD")
if not pw:
    sys.exit("RCON_PASSWORD not set in the environment")

want = {"enable-rcon": "true", "rcon.port": "25575", "rcon.password": pw}

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
    "# PHASE 1 BOOTSTRAP - not yet authoritative.",
    "# Seeded from the pack's own server.properties so the server can boot before",
    "# Postgres exists. From Phase 3 onward this file is RENDERED from the database",
    "# per ADR-0002, and anything edited here is lost on the next Apply.",
]

with open(path, "w") as fh:
    fh.write("\n".join(header + out) + "\n")

print("rcon keys set: " + ", ".join(sorted(want)))
