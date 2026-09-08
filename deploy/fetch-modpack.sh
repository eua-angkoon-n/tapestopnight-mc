#!/usr/bin/env bash
# Materialise the Modpack onto the Host (ADR-0009).
#
# The pack is not in git — 565 MB of jars git cannot delta-compress. This
# script is the reproducible path from the pinned SHA256 to a server
# directory. It refuses to unpack anything whose hash does not match.
#
#   ./fetch-modpack.sh [--force]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=modpack.lock
source "$HERE/modpack.lock"

DIST="${DIST_DIR:-/srv/mc/dist}"
PACK="${PACK_DIR:-/srv/mc/pack}"
ARCHIVE="$DIST/dregora-${MODPACK_VERSION}-serverpack.zip"
FORCE="${1:-}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Obtain the archive ────────────────────────────────────────────
if [[ -f "$ARCHIVE" ]]; then
  log "Using existing archive: $ARCHIVE"
elif [[ -n "${MODPACK_URL:-}" ]]; then
  log "Downloading $MODPACK_NAME $MODPACK_VERSION"
  mkdir -p "$DIST"
  curl -fL --progress-bar -o "$ARCHIVE.part" "$MODPACK_URL"
  mv "$ARCHIVE.part" "$ARCHIVE"
else
  die "No archive at $ARCHIVE and MODPACK_URL is empty in modpack.lock.
       Either place the zip there, or set MODPACK_URL so this is reproducible."
fi

# ── 2. Verify before touching anything ───────────────────────────────
log "Verifying SHA256"
actual_size=$(stat -c%s "$ARCHIVE")
[[ "$actual_size" == "$MODPACK_SIZE_BYTES" ]] \
  || die "Size mismatch: got $actual_size, expected $MODPACK_SIZE_BYTES"
actual_hash=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
if [[ "$actual_hash" != "$MODPACK_SHA256" ]]; then
  die "SHA256 mismatch — refusing to unpack.
       expected $MODPACK_SHA256
       actual   $actual_hash
       Mod version drift is the usual cause of clients being unable to join.
       Do not 'fix' this by updating the lock unless you intend a pack change."
fi
echo "    ok — $actual_hash"

# ── 3. Unpack ────────────────────────────────────────────────────────
if [[ -d "$PACK" && -n "$(ls -A "$PACK" 2>/dev/null)" && "$FORCE" != "--force" ]]; then
  die "$PACK is not empty. Re-run with --force to overwrite pack content.
       NOTE: --force does not touch the world directory or server.properties."
fi
log "Unpacking to $PACK"
mkdir -p "$PACK"
unzip -q -o "$ARCHIVE" -d "$PACK"

# ── 4. Drop client-only payload ──────────────────────────────────────
# Verified by inspecting the archive, not guessed:
#   resources/        135.8 MB — main-menu animation frames, Dynamic
#                     Surroundings sounds, loading screens, GUI textures.
#                     All .png/.jpg/.ogg/.mcmeta resource-pack assets, and
#                     server.properties has resource-pack= EMPTY, so the
#                     server never serves them either.
#   resourcepacks/     16.9 MB — client resource packs
#   shaderpacks/        3.7 MB — client shaders
#   fancymenu_data/     1.7 MB — FancyMenu (client main-menu mod) assets
#   options*.txt              — client video/OptiFine/shader settings
#
# KEPT deliberately:
#   structures/        12.1 MB — .rcst/.rcig/.rcgp/.rcbm are Recurrent Complex
#                     structure definitions plus .schematic files. These drive
#                     WORLDGEN, which is server-side. Removing them silently
#                     produces a world missing its structures.
#
# NEVER remove anything from mods/ — Forge 1.12.2 performs a mod-list
# handshake on connect. A server mod list that differs from the client's gets
# players kicked with mod rejections, even for client-only mods that simply
# do not initialise server-side.
log "Removing client-only payload"
before=$(du -sm "$PACK" | cut -f1)
for p in "${CLIENT_ONLY_PATHS[@]}"; do
  if [[ -e "$PACK/$p" ]]; then
    sz=$(du -sm "$PACK/$p" 2>/dev/null | cut -f1)
    rm -rf "$PACK/$p"
    printf '    removed  %-20s %5s MB\n' "$p" "$sz"
  fi
done
after=$(du -sm "$PACK" | cut -f1)
echo "    ${before} MB -> ${after} MB"

# ── 5. Apply the overlay ─────────────────────────────────────────────
# Git tracks only the pack files we deliberately changed (ADR-0009).
OVERLAY="$(cd "$HERE/.." && pwd)/overlay"
if [[ -d "$OVERLAY" ]]; then
  log "Applying overlay"
  n=0
  while IFS= read -r -d '' f; do
    rel="${f#"$OVERLAY"/}"
    mkdir -p "$PACK/$(dirname "$rel")"
    cp -f "$f" "$PACK/$rel"
    echo "    $rel"
    n=$((n+1))
  done < <(find "$OVERLAY" -type f ! -name '.gitkeep' -print0)
  [[ $n -eq 0 ]] && echo "    (overlay is empty — nothing customised yet)"
fi

log "Done"
echo "  pack : $PACK"
echo "  mods : $(find "$PACK/mods" -name '*.jar' 2>/dev/null | wc -l) jars"
echo "  MC   : $MINECRAFT_VERSION / Forge $FORGE_VERSION / Java $JAVA_MAJOR"
echo
echo "  server.properties is NOT written by this script — it is rendered from"
echo "  Postgres (ADR-0002). Phase 1 seeds it from the pack's own copy once."
