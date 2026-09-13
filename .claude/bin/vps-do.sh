#!/usr/bin/env bash
#
# Mutating access to the tapestopnight Host.
#
# Mechanically identical to vps-read.sh. The difference is entirely in
# .claude/settings.json, where this wrapper is listed under `ask` so every call
# raises an approval prompt, and in the expectation that whoever approves it has
# read the five-field proposal described in CLAUDE.md.
#
# Before you run this, the proposal should have answered: what happens if we do
# nothing for 30 minutes? That question retires more of these calls than any
# other.
#
# Usage:  .claude/bin/vps-do.sh 'cd /srv/mc/repo/deploy && docker compose pull'
set -euo pipefail

KEY="${TAPESTOPNIGHT_SSH_KEY:-$HOME/.ssh/id_ed25519}"
TARGET="${TAPESTOPNIGHT_SSH_TARGET:-root@217.216.111.122}"

if [ $# -eq 0 ]; then
  echo "usage: $0 '<command to run on the Host>'" >&2
  exit 64
fi

CMD="$*"

printf '>>> on %s:\n>>> %s\n\n' "$TARGET" "$CMD" >&2
exec ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$TARGET" "$CMD"
