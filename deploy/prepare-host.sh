#!/usr/bin/env bash
# Host prerequisites that must be in place BEFORE the Game Server starts.
# Idempotent; safe to re-run.
set -euo pipefail

PACK="${PACK_DIR:-/srv/mc/pack}"

# The JVM opens its GC log at startup (ADR-0012 needs that log to measure
# pauses). If /data/logs does not exist yet, Java 8 prints
#   "Cannot open file /data/logs/gc.log due to No such file or directory"
# and silently runs with no GC logging. The pack ships no logs/ directory and
# log4j only creates it ~55 seconds into boot — long after the JVM needed it.
# The container runs as uid/gid 1000.
if [[ ! -d "$PACK/logs" ]]; then
  mkdir -p "$PACK/logs"
  echo "created $PACK/logs"
fi
chown 1000:1000 "$PACK/logs"
echo "$PACK/logs ready (owner 1000:1000)"
