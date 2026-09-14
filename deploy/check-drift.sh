#!/usr/bin/env bash
#
# Report configuration drift on the Host — ADR-0009.
#
# The overlay records the pack files we deliberately changed, and deploy is
# "unpack the verified zip, then copy the overlay over it". That gives a precise
# history of our customisations, but it has one blind spot it cannot close on
# its own: a file somebody edits directly on the Host. Nothing in git moves,
# nothing looks wrong, and the discovery happens months later while debugging
# something unrelated.
#
# ── Why this compares against a BASELINE, not against the zip ────────────────
#
# The plan said "compare the Host's live config against (verified zip +
# overlay)". Done literally, the first real run reported 23 changed and 113
# added files — and not one of them was a human edit. Forge mods rewrite their
# own .cfg on first boot, and srpmixins alone generates 96 loot tables. A daily
# job that reports 136 items every day is worse than no job: it teaches
# everyone to ignore it, and the one real edit arrives inside that noise.
#
# So the default comparison is against an ACCEPTED BASELINE — a manifest of the
# live tree taken once the pack has been deployed and booted. After that, drift
# means "something changed since we last looked", which is the question ADR-0009
# actually wants answered. Re-accept after a deliberate pack upgrade.
#
# The literal zip-versus-Host comparison is still here as --vs-pack, because
# "how far have we diverged from upstream" is a real question too — just not a
# daily one.
#
# READ-ONLY unless you pass --accept. Drift is reported for a human to judge,
# because "reset it" is sometimes exactly wrong: the hand edit may be the fix,
# and the overlay may be what needs updating.
#
#   deploy/check-drift.sh              # vs accepted baseline (what cron runs)
#   deploy/check-drift.sh --accept     # record the current state as accepted
#   deploy/check-drift.sh --vs-pack    # vs (verified zip + overlay)
#
# Exit codes:  0 no drift   1 drift found   2 cannot run
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
PACK_DIR="${PACK_DIR:-/srv/mc/pack}"
# shellcheck source=modpack.lock
source "${HERE}/modpack.lock"
# Built from the pin rather than written out, so --vs-pack cannot end up
# comparing against the previous pack's zip after an upgrade. That is not
# hypothetical: this line said "dregora-v1.1.2b" while the lock said Homestead.
ZIP_PATH="${ZIP_PATH:-/srv/mc/dist/homestead-${MODPACK_VERSION}-serverpack.zip}"
STATE_DIR="${STATE_DIR:-/srv/mc/state}"
BASELINE="${STATE_DIR}/drift-baseline.sha256"

# Only these are compared. The rest of the pack is jars we never touch, plus
# runtime state (world, logs, crash reports) that is SUPPOSED to change.
SUBTREES=("config" "scripts")

MODE="${1:-baseline}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "CANNOT RUN: $*"; exit 2; }

[ -d "${PACK_DIR}" ] || die "pack directory ${PACK_DIR} does not exist"

# A stable, sorted "path  sha256" manifest of the live tree.
manifest_live() {
  for sub in "${SUBTREES[@]}"; do
    [ -d "${PACK_DIR}/${sub}" ] || continue
    ( cd "${PACK_DIR}" && find "${sub}" -type f -print0 | sort -z | xargs -0 -r sha256sum )
  done
}

case "${MODE}" in
  --accept)
    mkdir -p "${STATE_DIR}"
    manifest_live > "${BASELINE}.tmp"
    mv "${BASELINE}.tmp" "${BASELINE}"
    log "accepted $(wc -l < "${BASELINE}") file(s) as the baseline"
    log "  ${BASELINE}"
    log "  from here on, any difference is reported. Re-run --accept after a"
    log "  deliberate pack upgrade, and never to silence a report you have not read."
    exit 0
    ;;

  baseline)
    [ -f "${BASELINE}" ] || die "no accepted baseline yet.
     Deploy the pack, let the server boot once so mods write their configs,
     then record the result:  deploy/check-drift.sh --accept"

    NOW="$(mktemp)"; trap 'rm -f "${NOW}"' EXIT
    manifest_live > "${NOW}"

    # Compare manifests as sets of "hash  path" lines. diff on sorted files is
    # both faster and clearer than walking the tree twice.
    changed=$(comm -13 <(sort "${BASELINE}") <(sort "${NOW}") | awk '{print $2}' | sort -u)
    gone=$(comm -23 <(sort "${BASELINE}") <(sort "${NOW}") | awk '{print $2}' | sort -u)

    added=$(comm -13 <(awk '{print $2}' "${BASELINE}" | sort) <(awk '{print $2}' "${NOW}" | sort))
    removed=$(comm -23 <(awk '{print $2}' "${BASELINE}" | sort) <(awk '{print $2}' "${NOW}" | sort))
    # "changed" so far includes added files; subtract them to separate the two.
    modified=$(comm -23 <(echo "${changed}") <(echo "${added}") | sed '/^$/d')
    unused="${gone}"; : "${unused}"

    n_mod=$(printf '%s' "${modified}" | grep -c . || true)
    n_add=$(printf '%s' "${added}" | grep -c . || true)
    n_del=$(printf '%s' "${removed}" | grep -c . || true)
    total=$(( n_mod + n_add + n_del ))

    if [ "${total}" -eq 0 ]; then
      log "no drift — $(wc -l < "${NOW}") file(s) match the accepted baseline"
      exit 0
    fi

    log "DRIFT since the accepted baseline: ${n_mod} modified, ${n_add} added, ${n_del} removed"
    [ -n "${modified}" ] && echo "${modified}" | sed 's/^/  MODIFIED  /'
    [ -n "${added}" ]    && echo "${added}"    | sed 's/^/  ADDED     /'
    [ -n "${removed}" ]  && echo "${removed}"  | sed 's/^/  REMOVED   /'

    cat <<'EOF'

  Nothing was changed — what to do is a judgement call. A hand edit on the Host
  is often the right fix applied in the wrong place: copy it into overlay/ and
  commit, so the next deploy keeps it. If a mod wrote it and that is expected,
  re-accept the baseline. If it was a mistake, redeploy the pack.
EOF
    exit 1
    ;;

  --vs-pack)
    command -v unzip >/dev/null || die "unzip is not installed"
    [ -f "${ZIP_PATH}" ] || die "the server pack zip is not at ${ZIP_PATH}"

    # The hash is the whole point of ADR-0009: a baseline that might be the
    # wrong version is worse than none, because it produces confident nonsense.
    if [ -f "${REPO}/deploy/modpack.lock" ]; then
      # modpack.lock is shell syntax on purpose, so it is sourced rather than
      # parsed. A hand-rolled grep is the kind of thing that silently matches
      # nothing and turns the check into a no-op that reports success forever.
      # shellcheck disable=SC1091
      MODPACK_SHA256=""
      . "${REPO}/deploy/modpack.lock"
      if [ -n "${MODPACK_SHA256}" ]; then
        actual="$(sha256sum "${ZIP_PATH}" | cut -d' ' -f1)"
        [ "${actual}" = "${MODPACK_SHA256}" ] || die "the zip is not the pinned version.
     expected ${MODPACK_SHA256}
     actual   ${actual}"
        log "baseline zip verified against modpack.lock"
      fi
    fi

    WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
    log "unpacking the pristine pack (this takes a moment)"
    for sub in "${SUBTREES[@]}"; do
      unzip -qq -o "${ZIP_PATH}" "${sub}/*" -d "${WORK}/base" 2>/dev/null || true
    done
    for sub in "${SUBTREES[@]}"; do
      if [ -d "${REPO}/overlay/${sub}" ]; then
        mkdir -p "${WORK}/base/${sub}"
        cp -a "${REPO}/overlay/${sub}/." "${WORK}/base/${sub}/" 2>/dev/null || true
      fi
    done

    changed=(); added=(); removed=()
    for sub in "${SUBTREES[@]}"; do
      base="${WORK}/base/${sub}"; live="${PACK_DIR}/${sub}"
      [ -d "${base}" ] || continue
      [ -d "${live}" ] || { removed+=("${sub}/ (missing on the Host)"); continue; }
      while IFS= read -r -d '' f; do
        rel="${f#"${base}/"}"
        if [ ! -e "${live}/${rel}" ]; then removed+=("${sub}/${rel}")
        elif ! cmp -s "${f}" "${live}/${rel}"; then changed+=("${sub}/${rel}"); fi
      done < <(find "${base}" -type f -print0)
      while IFS= read -r -d '' f; do
        rel="${f#"${live}/"}"
        [ -e "${base}/${rel}" ] || added+=("${sub}/${rel}")
      done < <(find "${live}" -type f -print0)
    done

    log "vs pristine pack: ${#changed[@]} changed, ${#added[@]} added, ${#removed[@]} removed"
    log "NOTE: most of this is normal. Forge mods rewrite their own .cfg on"
    log "      first boot and generate data files; that is why the daily check"
    log "      uses an accepted baseline instead of this comparison."
    for f in "${changed[@]}"; do echo "  CHANGED  ${f}"; done
    for f in "${added[@]}";   do echo "  ADDED    ${f}"; done
    for f in "${removed[@]}"; do echo "  REMOVED  ${f}"; done
    [ $(( ${#changed[@]} + ${#added[@]} + ${#removed[@]} )) -eq 0 ] && exit 0 || exit 1
    ;;

  *)
    die "usage: check-drift.sh [--accept|--vs-pack]"
    ;;
esac
