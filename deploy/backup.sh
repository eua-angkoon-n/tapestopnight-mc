#!/usr/bin/env bash
#
# Back up the two things that cannot be rebuilt: the world and Postgres.
#
# Everything else on this Host is reproducible from git plus the pinned
# modpack SHA256. The world is not — after pre-generation it represents hours
# of CPU that nobody wants to spend twice — and Postgres holds the Desired
# Config, the audit trail and the Server Icon.
#
# THE WORLD IS FLUSHED FIRST. Copying a live Minecraft world without pausing
# saves gives you a torn snapshot: region files written in the middle of the
# tar are internally inconsistent, and the damage does not appear until a
# player walks into that chunk weeks later. So: save-off, save-all flush, copy,
# save-on — with save-on guaranteed by a trap, because a world left with saving
# disabled silently discards everything until the next restart.
#
#   deploy/backup.sh              # both
#   deploy/backup.sh db           # Postgres only
#   deploy/backup.sh world        # world only
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/mc/backups}"
PACK_DIR="${PACK_DIR:-/srv/mc/pack}"
LEVEL_NAME="${LEVEL_NAME:-DregoraRL}"
MC_CONTAINER="${MC_CONTAINER:-tapestopnight-mc}"
DB_CONTAINER="${DB_CONTAINER:-tapestopnight-db}"

# How many of each to keep. Daily runs, so 14 is a fortnight of history —
# enough to notice "the world has been wrong since last Tuesday".
KEEP="${KEEP:-14}"

WHAT="${1:-all}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

# shellcheck disable=SC1091
set -a; . "${HERE}/.env"; set +a

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FAILED: $*"; exit 1; }

mkdir -p "${BACKUP_ROOT}/db" "${BACKUP_ROOT}/world"

backup_db() {
  local out="${BACKUP_ROOT}/db/db-${STAMP}.sql.gz"
  log "dumping Postgres -> ${out}"
  # Streamed straight out of the container and gzipped here, so no temporary
  # copy ever lands inside the container's filesystem.
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${DB_CONTAINER}" \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --clean --if-exists \
    | gzip -9 > "${out}" || die "pg_dump"

  # A dump that cannot be read back is not a backup. gzip -t is cheap and
  # catches the truncation a full disk produces.
  gzip -t "${out}" || die "the dump is not a readable gzip"
  [ "$(stat -c%s "${out}")" -gt 1000 ] || die "the dump is suspiciously small"
  log "  ok, $(du -h "${out}" | cut -f1)"
}

saves_on() {
  # Runs on every exit path. A world left with save-off keeps playing and
  # quietly throws away everything until the next restart, which is a far
  # worse outcome than a failed backup.
  docker exec "${MC_CONTAINER}" rcon-cli save-on >/dev/null 2>&1 || \
    log "WARNING: could not re-enable saving — run: docker exec ${MC_CONTAINER} rcon-cli save-on"
}

backup_world() {
  local out="${BACKUP_ROOT}/world/world-${STAMP}.tar.gz"
  local running=0
  docker inspect -f '{{.State.Running}}' "${MC_CONTAINER}" 2>/dev/null | grep -q true && running=1

  # ── Do not do this in the middle of a pre-generation ──────────────
  #
  # save-off during pregen does not pause the generator; it only stops the
  # chunks it produces from reaching disk, so they queue in the heap instead.
  # Pregen already runs the JVM near its cgroup limit (ADR-0012), and the OOM
  # killer picks the largest process, which is the game server. Trading a
  # night's backup for an OOM kill mid-generation is the wrong way round —
  # especially as the world before pregen is already archived, and pregenerated
  # terrain is reproducible by re-running the pregen.
  if [ "${running}" = "1" ] && docker exec "${MC_CONTAINER}" rcon-cli "pregen info ShowTaskList" 2>/dev/null | grep -qiE "[1-9][0-9]* Tasks"; then
    log "SKIPPING the world backup: a pre-generation is running."
    log "  save-off would queue generated chunks in the heap next to a JVM"
    log "  already near its limit. The Postgres backup still ran."
    log "  Run 'deploy/backup.sh world' once pregen finishes."
    return 0
  fi

  if [ "${running}" = "1" ]; then
    log "pausing saves and flushing"
    trap saves_on EXIT
    docker exec "${MC_CONTAINER}" rcon-cli save-off >/dev/null || die "save-off"
    # `save-all flush` blocks until the write completes, unlike `save-all`.
    docker exec "${MC_CONTAINER}" rcon-cli save-all flush >/dev/null || die "save-all flush"
    docker exec "${MC_CONTAINER}" rcon-cli say "[เซิร์ฟเวอร์] กำลังสำรองข้อมูลโลก อาจกระตุกเล็กน้อยสักครู่" >/dev/null || true
  else
    log "container is not running — copying the world as-is, no flush needed"
  fi

  log "archiving ${PACK_DIR}/${LEVEL_NAME} -> ${out}"
  tar -C "${PACK_DIR}" -czf "${out}" "${LEVEL_NAME}" || die "tar"

  if [ "${running}" = "1" ]; then
    saves_on
    trap - EXIT
    log "saving re-enabled"
  fi

  tar -tzf "${out}" >/dev/null || die "the archive is not readable"
  log "  ok, $(du -h "${out}" | cut -f1)"
}

prune() {
  local dir="$1" pattern="$2"
  # shellcheck disable=SC2012
  local extra
  extra=$(ls -1t "${dir}/${pattern}" 2>/dev/null | tail -n +$((KEEP + 1)) || true)
  if [ -n "${extra}" ]; then
    log "pruning $(echo "${extra}" | wc -l) old backup(s) from ${dir}"
    echo "${extra}" | xargs -r rm -f
  fi
}

case "${WHAT}" in
  db)    backup_db ;;
  world) backup_world ;;
  all)   backup_db; backup_world ;;
  *)     die "usage: backup.sh [all|db|world]" ;;
esac

prune "${BACKUP_ROOT}/db" "db-*.sql.gz"
prune "${BACKUP_ROOT}/world" "world-*.tar.gz"

log "done. ${BACKUP_ROOT} now holds:"
du -sh "${BACKUP_ROOT}"/* 2>/dev/null | sed 's/^/  /'
df -h / | tail -1 | awk '{print "  disk: " $4 " free (" $5 " used)"}'
