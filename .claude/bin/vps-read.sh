#!/usr/bin/env bash
#
# Read-only access to the tapestopnight Host.
#
# This exists so the PERMISSION LAYER can tell a diagnosis from a change.
# .claude/settings.json allows this wrapper without prompting and puts
# vps-do.sh behind an approval prompt; that distinction is the whole point,
# and it only works if agents never call ssh directly (guard.ps1 enforces that).
#
# Honest about what this is: the refusal list below is a courtesy rail, not a
# security boundary. It catches the obvious mutating verbs so that reaching for
# one is a deliberate switch to vps-do.sh rather than an accident. Anyone
# determined to mutate through this script can. The real protection is that
# vps-do.sh always asks a human.
#
# Usage:  .claude/bin/vps-read.sh 'docker ps'
set -euo pipefail

KEY="${TAPESTOPNIGHT_SSH_KEY:-$HOME/.ssh/id_ed25519}"
TARGET="${TAPESTOPNIGHT_SSH_TARGET:-root@217.216.111.122}"

if [ $# -eq 0 ]; then
  echo "usage: $0 '<command to run on the Host>'" >&2
  exit 64
fi

CMD="$*"

# Mutating verbs. Not exhaustive by design - see the note above.
#
# Deliberately NOT in this list:
#   docker exec   - read-only RCON queries (rcon-cli list, pregen info) and psql
#                   inspection go through it, and they are core diagnosis. The
#                   dangerous RCON verbs get their own pattern below instead.
#   bare >        - "curl -w '... -> %{http_code}'" and ">/dev/null" are both
#                   common and harmless. Only redirection into a real system
#                   path is caught.
if printf '%s' "$CMD" | grep -qE '(^|[[:space:];&|])(rm|mv|cp|chmod|chown|truncate|dd|mkfs|systemctl|service|apt|apt-get|ufw|reboot|shutdown|useradd|usermod|crontab|pkill|kill)([[:space:]]|$)'    || printf '%s' "$CMD" | grep -qE 'docker[[:space:]]+(compose[[:space:]]+)?(stop|start|restart|kill|rm|down|up|pull|push|prune|cp|load|import)([[:space:]]|$)'    || printf '%s' "$CMD" | grep -qE 'rcon-cli[^|;]*(stop|save-off|[[:space:]]op[[:space:]]|deop|ban|kick|whitelist|gamerule|worldborder|pregen[[:space:]]+gen|setblock|fill)'    || printf '%s' "$CMD" | grep -qE '(^|[[:space:]])(tee|sed[[:space:]]+-[a-z]*i)([[:space:]]|$)'    || printf '%s' "$CMD" | grep -qE '>[[:space:]]*/(srv|etc|opt|var|root|home|usr)'; then
  cat >&2 <<MSG
vps-read.sh refuses this: it looks like it changes something.

  $CMD

If that is what you mean to do, propose it to the operator and run it through:

  .claude/bin/vps-do.sh '<the same command>'

If it is genuinely read-only and this rail is being clumsy, say so - the wrapper
is meant to be adjusted, not worked around.
MSG
  exit 77
fi

exec ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$TARGET" "$CMD"
