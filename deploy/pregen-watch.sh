#!/usr/bin/env bash
#
# Pre-generate the world while nobody is playing, and say so on Discord.
#
# Chunky ships with the pack and has no notion of "only when the server is
# empty" and no rate limit. Left alone it competes with players for the tick
# and, on this Host, with the cgroup for memory: on 2026-11-01 a full-speed
# run took a 7G heap to an OOM crash, because generated chunks queue in the
# heap faster than they are written out (ADR-0023, ADR-0024). So this loop
# is the pacing Chunky lacks. Every POLL_SECS it asks four questions —
#
#   is anyone online?          → pause at once; players come first
#   is the heap filling?       → pause until it has drained
#   is the backup about to run → pause; save-off during a pregen is the
#                                same backlog by another route (backup.sh)
#   has the task finished?     → start the next one in QUEUE
#
# — and resumes only after the server has been empty for EMPTY_SECS.
#
# It talks to the server over RCON and never starts, stops or restarts the
# container. A server that is down, or not answering, is left alone and
# asked again on the next round.
#
#   deploy/pregen-watch.sh                # the loop (run by systemd)
#   deploy/pregen-watch.sh --test-notify  # post one message and exit
#   deploy/pregen-watch.sh --status       # print the saved state and exit
#   deploy/pregen-watch.sh --once         # one round, for testing
#
# Deliberately not `set -e`: one failed docker exec must not end a loop
# whose whole job is to be there when the next player logs in.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="${PACK_DIR:-/srv/mc/pack}"
MC_CONTAINER="${MC_CONTAINER:-tapestopnight-mc}"
STATE_DIR="${STATE_DIR:-/srv/mc/state/pregen}"
ENV_FILE="${ENV_FILE:-${HERE}/.env}"
GC_LOG="${GC_LOG:-${PACK_DIR}/logs/gc.log}"
SERVER_LOG_DIR="${SERVER_LOG_DIR:-${PACK_DIR}/logs}"

# What to generate, in order: "<world> <radius in blocks> <centre>".
# `spawn` centres on the world spawn; anything else is passed to
# `chunky center` as given. The Nether is a third of the overworld's radius
# rather than an eighth because people travel in it for its own sake here.
QUEUE=(
  "minecraft:overworld 3000 spawn"
  "minecraft:the_nether 1000 0 0"
  "minecraft:the_end 2000 0 0"
)

POLL_SECS="${POLL_SECS:-15}"
# How long the server must have been empty before generation starts or
# resumes. Long enough that someone reconnecting after a crash, or a group
# changing over, does not get a pregen started under them.
EMPTY_SECS="${EMPTY_SECS:-300}"
REPORT_SECS="${REPORT_SECS:-900}"

# Heap occupancy AFTER the most recent collection, from the GC log, in MB.
# The heap is 7168M. Idle with players it sits near 2200M (2026-11-22). The
# pause line is where a save backlog is unmistakable but a full GC is still
# some way off; the resume line is close to idle, so a resumed run starts
# with room. Both are first guesses to be corrected against a real run.
PAUSE_HEAP_MB="${PAUSE_HEAP_MB:-5000}"
RESUME_HEAP_MB="${RESUME_HEAP_MB:-3000}"
# The cgroup is 10g and must never record a `max` event (ADR-0024).
PAUSE_CGROUP_MB="${PAUSE_CGROUP_MB:-9625}"
# After a pause for memory, wait at least this long whatever the heap says.
COOLDOWN_SECS="${COOLDOWN_SECS:-120}"

# The backup runs at 05:00 and the drift check at 05:30, Bangkok time
# (deploy/cron/tapestopnight). HHMM, start inclusive, end exclusive.
QUIET_FROM="${QUIET_FROM:-0450}"
QUIET_UNTIL="${QUIET_UNTIL:-0600}"

# The main channel, where milestones are already announced.
DISCORD_CHANNEL_ID="${DISCORD_CHANNEL_ID:-707287521750417491}"

# What Chunky prints, so that nothing below matches against a guess. Each
# was read from this server over RCON or from logs/latest.log.
#   idle, `chunky progress`:   [Chunky] No tasks running.          (2026-11-22)
#   task finished, server log: NOT YET OBSERVED — see FINISHED_RE
CHUNKY_IDLE_RE='No tasks running'
# UNVERIFIED until a task has been seen to finish on this server. If it is
# wrong the loop does not skip ahead: a task it cannot prove finished is
# treated as interrupted, resumed, and after STALL_LIMIT rounds reported to
# Discord for a human to look at.
FINISHED_RE='\[Chunky\] Task finished for %s'
STALL_LIMIT="${STALL_LIMIT:-5}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ── saved state ──────────────────────────────────────────────────────
# One small file per value, so a restart of this script — or of the Host —
# picks up where it left off, and so `--status` is just `cat`.
#   index   position in QUEUE
#   state   idle | running | paused | done | stuck
get() { cat "${STATE_DIR}/$1" 2>/dev/null || printf '%s' "${2:-}"; }
put() { printf '%s' "$2" > "${STATE_DIR}/$1"; }

# ── the server ───────────────────────────────────────────────────────
rcon() { timeout 20 docker exec "${MC_CONTAINER}" rcon-cli "$@" 2>/dev/null | sed -E 's/§.//g'; }

container_running() {
  docker inspect -f '{{.State.Running}}' "${MC_CONTAINER}" 2>/dev/null | grep -q true
}

# Prints the number of players, or fails if RCON did not answer. The two
# are kept apart on purpose: "no answer" must never be read as "nobody".
players() {
  local out
  out="$(rcon list)" || return 1
  [[ "${out}" =~ There\ are\ ([0-9]+)\ of ]] || return 1
  printf '%s' "${BASH_REMATCH[1]}"
}

# A line like `... Pause Young (Normal) ... 4372M->2271M(7168M) 215.985ms`;
# the number after the arrow is what survived the collection.
heap_after_mb() {
  tail -n 400 "${GC_LOG}" 2>/dev/null \
    | grep -oE '[0-9]+M->[0-9]+M\([0-9]+M\)' | tail -n 1 \
    | sed -E 's/.*->([0-9]+)M.*/\1/'
}

full_gc_count() { grep -c 'Pause Full.*->' "${GC_LOG}" 2>/dev/null || true; }

cgroup_mb() {
  local bytes
  bytes="$(timeout 20 docker exec "${MC_CONTAINER}" cat /sys/fs/cgroup/memory.current 2>/dev/null)" || return 1
  [[ "${bytes}" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$(( bytes / 1048576 ))"
}

in_quiet_window() {
  local now
  now="$(TZ=Asia/Bangkok date +%H%M)"
  (( 10#${now} >= 10#${QUIET_FROM} && 10#${now} < 10#${QUIET_UNTIL} ))
}

# ── Discord ──────────────────────────────────────────────────────────
# A plain REST call with the bot's token. It opens no gateway session, so it
# cannot displace the bot's own connection (ADR-0008: one session per token).
# Only the one key is read from .env, and it reaches curl on stdin — never
# on a command line, where `ps` and a transcript would both show it.
discord_token() {
  grep -m1 '^DISCORD_BOT_TOKEN=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'\r'
}

notify() {
  local text="$1" token body code
  log "discord: ${text//$'\n'/ | }"
  token="$(discord_token)"
  [ -n "${token}" ] || { log "  no DISCORD_BOT_TOKEN in ${ENV_FILE}; not sent"; return 0; }
  body="$(python3 -c 'import json,sys; print(json.dumps({"content": sys.argv[1], "allowed_mentions": {"parse": []}}))' "${text}")" \
    || { log "  could not encode the message; not sent"; return 0; }
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -K - \
      -A 'DiscordBot (https://tapestopnight.com, 1.0)' \
      -H 'Content-Type: application/json' -d "${body}" \
      "https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages" 2>/dev/null <<EOF
header = "Authorization: Bot ${token}"
EOF
  )" || code="curl failed"
  # A message that did not arrive is logged and forgotten. Discord being
  # down is no reason to stop watching for players.
  [ "${code}" = "200" ] || log "  Discord answered ${code}"
  return 0
}

# ── tasks ────────────────────────────────────────────────────────────
task_world()  { local t=(${QUEUE[$1]}); printf '%s' "${t[0]}"; }
task_radius() { local t=(${QUEUE[$1]}); printf '%s' "${t[1]}"; }
task_centre() { local t=(${QUEUE[$1]}); printf '%s' "${t[*]:2}"; }

memory_line() {
  printf 'heap หลัง GC %sM / 7168M · cgroup %sM / 10240M' "${1:-?}" "${2:-?}"
}

start_task() {
  local i="$1" world radius centre
  world="$(task_world "$i")"; radius="$(task_radius "$i")"; centre="$(task_centre "$i")"
  log "starting ${world} radius ${radius} centre ${centre}"
  log "  $(rcon "chunky world ${world}")"
  log "  $(rcon "chunky shape square")"
  if [ "${centre}" = "spawn" ]; then
    log "  $(rcon "chunky spawn")"
  else
    log "  $(rcon "chunky center ${centre}")"
  fi
  log "  $(rcon "chunky radius ${radius}")"
  # Chunky's default is a progress line every second; once a minute is
  # enough for a log that people also read for other things.
  log "  $(rcon "chunky quiet 60")"
  log "  $(rcon "chunky start")"
  put state running
  put started_at "$(date +%s)"
  put log_mark "$(stat -c %s "${SERVER_LOG_DIR}/latest.log" 2>/dev/null || echo 0)"
  put last_report "$(date +%s)"
  put stalls 0
  notify "🗺️ **Pregen เริ่ม** — \`${world}\` รัศมี ${radius} บล็อก ($(( i + 1 ))/${#QUEUE[@]})
ไม่มีผู้เล่นออนไลน์ จะหยุดพักเองทันทีที่มีคนเข้า"
}

pause_task() {
  local reason="$1"
  log "pausing: ${reason}"
  log "  $(rcon "chunky pause")"
  put state paused
  put paused_at "$(date +%s)"
  put pause_reason "${reason}"
  notify "⏸️ **Pregen หยุดพัก** — ${reason}"
}

resume_task() {
  log "resuming"
  log "  $(rcon "chunky continue")"
  put state running
  put last_report "$(date +%s)"
  notify "▶️ **Pregen ทำต่อ** — \`$(task_world "$(get index 0)")\`"
}

# Did the server log say this world's task finished, since we started it?
# Looks at latest.log from the byte we noted at the start — or all of it, if
# it has been rotated since and is now shorter — and at any rotated log
# written after the start.
finished_in_log() {
  local world="$1" re mark size started
  # shellcheck disable=SC2059
  re="$(printf "${FINISHED_RE}" "${world}")"
  mark="$(get log_mark 0)"; started="$(get started_at 0)"
  size="$(stat -c %s "${SERVER_LOG_DIR}/latest.log" 2>/dev/null || echo 0)"
  (( size < mark )) && mark=0
  tail -c "+$(( mark + 1 ))" "${SERVER_LOG_DIR}/latest.log" 2>/dev/null | grep -qE "${re}" && return 0
  local f
  while IFS= read -r f; do
    zcat "${f}" 2>/dev/null | grep -qE "${re}" && return 0
  done < <(find "${SERVER_LOG_DIR}" -maxdepth 1 -name '*.log.gz' -newermt "@${started}" 2>/dev/null)
  return 1
}

advance() {
  local i="$1" world
  world="$(task_world "$i")"
  i=$(( i + 1 ))
  put index "${i}"
  if (( i >= ${#QUEUE[@]} )); then
    put state done
    notify "✅ **Pregen เสร็จครบทุกมิติแล้ว** — จบที่ \`${world}\`"
    return 0
  fi
  put state idle
  notify "✅ **Pregen มิติ \`${world}\` เสร็จ** — ต่อไป: \`$(task_world "$i")\`"
}

# ── one round ────────────────────────────────────────────────────────
EMPTY_SINCE=0

tick() {
  local n now heap full cg state index reason progress
  container_running || { log "container not running; waiting"; EMPTY_SINCE=0; return 0; }
  n="$(players)" || { log "RCON did not answer; waiting"; EMPTY_SINCE=0; return 0; }
  now="$(date +%s)"
  if (( n > 0 )); then EMPTY_SINCE=0; elif (( EMPTY_SINCE == 0 )); then EMPTY_SINCE="${now}"; fi

  heap="$(heap_after_mb)"; heap="${heap:-0}"
  full="$(full_gc_count)"; full="${full:-0}"
  cg="$(cgroup_mb)" || cg=0
  state="$(get state idle)"
  index="$(get index 0)"

  case "${state}" in
    running)
      reason=""
      if (( n > 0 )); then
        reason="มีผู้เล่นออนไลน์ ${n} คน"
      elif in_quiet_window; then
        reason="ช่วง backup ประจำวัน (ถึง ${QUIET_UNTIL:0:2}:${QUIET_UNTIL:2:2} น.)"
      elif (( full > $(get full_gcs "${full}") )); then
        reason="เกิด full GC — $(memory_line "${heap}" "${cg}")"
      elif (( heap >= PAUSE_HEAP_MB )); then
        reason="heap ใกล้เต็ม รอให้ระบายก่อน — $(memory_line "${heap}" "${cg}")"
      elif (( cg >= PAUSE_CGROUP_MB )); then
        reason="หน่วยความจำ container ใกล้เพดาน — $(memory_line "${heap}" "${cg}")"
      fi
      put full_gcs "${full}"
      if [ -n "${reason}" ]; then pause_task "${reason}"; return 0; fi

      progress="$(rcon "chunky progress")"
      if [ -z "${progress}" ]; then return 0; fi
      if [[ "${progress}" =~ ${CHUNKY_IDLE_RE} ]]; then
        if finished_in_log "$(task_world "${index}")"; then
          advance "${index}"
          return 0
        fi
        # Not running, and not provably finished: a server restart drops
        # the task (continueOnRestart is false). Treat it as paused so the
        # next round resumes it, and count how often that fails to take.
        local stalls=$(( $(get stalls 0) + 1 ))
        put stalls "${stalls}"
        log "no task running and no finish line in the log (${stalls}/${STALL_LIMIT})"
        if (( stalls >= STALL_LIMIT )); then
          put state stuck
          notify "⚠️ **Pregen ต้องให้คนดู** — \`$(task_world "${index}")\` ไม่ได้รันอยู่ และ log ไม่ได้บอกว่าเสร็จ watcher หยุดทำงานแล้ว"
          return 0
        fi
        put state paused
        put paused_at 0
        put pause_reason "task หายไป (เซิร์ฟเวอร์อาจ restart)"
        return 0
      fi
      put stalls 0
      if (( now - $(get last_report 0) >= REPORT_SECS )); then
        put last_report "${now}"
        notify "🗺️ **Pregen** \`$(task_world "${index}")\` ($(( index + 1 ))/${#QUEUE[@]})
${progress}
$(memory_line "${heap}" "${cg}")"
      fi
      ;;

    idle|paused)
      put full_gcs "${full}"
      (( n == 0 && EMPTY_SINCE > 0 && now - EMPTY_SINCE >= EMPTY_SECS )) || return 0
      in_quiet_window && return 0
      (( heap <= RESUME_HEAP_MB && cg < PAUSE_CGROUP_MB )) || return 0
      (( now - $(get paused_at 0) >= COOLDOWN_SECS )) || return 0
      if [ "${state}" = "idle" ]; then start_task "${index}"; else resume_task; fi
      ;;
  esac
  return 0
}

# ── entry ────────────────────────────────────────────────────────────
mkdir -p "${STATE_DIR}"

# Optional overrides for the functions above — how the state machine is
# exercised without a server (see the PR that added this file).
# shellcheck disable=SC1090
[ -n "${PREGEN_STUBS:-}" ] && . "${PREGEN_STUBS}"

case "${1:-}" in
  --test-notify)
    notify "🔧 ทดสอบการแจ้งเตือน pregen — ถ้าเห็นข้อความนี้ แปลว่าส่งถึงห้องนี้ได้"
    exit 0 ;;
  --status)
    for k in index state pause_reason started_at paused_at last_report stalls full_gcs; do
      printf '%-13s %s\n' "${k}" "$(get "${k}" -)"
    done
    exit 0 ;;
  --once)
    EMPTY_SINCE="${EMPTY_SINCE_OVERRIDE:-0}"
    tick
    exit 0 ;;
  "") ;;
  *) echo "usage: pregen-watch.sh [--test-notify|--status|--once]" >&2; exit 2 ;;
esac

# Stopping the watcher stops the generation. Without this a `systemctl stop`
# would leave Chunky running with nothing watching the heap or the door.
on_stop() {
  if [ "$(get state idle)" = "running" ]; then
    pause_task "watcher ถูกสั่งหยุด"
  fi
  exit 0
}
trap on_stop TERM INT

log "watching ${MC_CONTAINER}: ${#QUEUE[@]} tasks, state $(get state idle), index $(get index 0)"
while :; do
  case "$(get state idle)" in
    done)  log "every task is finished; nothing left to do"; exit 0 ;;
    stuck) log "stuck — remove ${STATE_DIR}/state after looking into it"; exit 0 ;;
  esac
  tick
  # `sleep & wait` rather than a bare sleep, so the trap fires at once.
  sleep "${POLL_SECS}" & wait $!
done
