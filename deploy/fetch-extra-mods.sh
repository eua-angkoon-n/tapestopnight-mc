#!/usr/bin/env bash
# Place the pinned extra mods into the Game Server's mods/ — ADR-0017.
#
# Same discipline as fetch-modpack.sh: verify the hash BEFORE anything lands
# where Forge will load it. A jar that is not what we pinned is not a jar we
# put in front of players.
#
#   ./fetch-extra-mods.sh            # install anything missing or wrong
#   ./fetch-extra-mods.sh --check    # report only, change nothing (exit 1 on drift)
#   ./fetch-extra-mods.sh --remove   # take them back out again
#
# Idempotent: a correct jar already in place is left alone, so this is safe to
# run on every deploy. `--remove` exists because "take the mod back out" is a
# real operation — ADR-0012 leaves little memory headroom, and the back-out
# has to be one command rather than a half-remembered filename.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=extra-mods.lock
source "$HERE/extra-mods.lock"
# shellcheck source=modpack.lock
source "$HERE/modpack.lock"

PACK="${PACK_DIR:-/srv/mc/pack}"
MODS="$PACK/mods"
MODE="${1:-install}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFATAL: %s\033[0m\n' "$*" >&2; exit 2; }

[[ -d "$MODS" ]] || die "$MODS does not exist — run fetch-modpack.sh first."

problems=0

for entry in "${EXTRA_MODS[@]}"; do
  IFS='|' read -r file url sha size mcver <<<"$entry"
  target="$MODS/$file"

  # ── The check that stops a pack upgrade from breaking the boot ──────
  #
  # These jars survive `fetch-modpack.sh --force`, because it unpacks with
  # `unzip -o` and never clears mods/. So a pack upgraded to a different
  # Minecraft version would keep a jar built for the old one, and Forge would
  # fail to start with an error that says nothing about this file.
  if [[ "$mcver" != "$MINECRAFT_VERSION" ]]; then
    die "$file is pinned for Minecraft $mcver but modpack.lock says $MINECRAFT_VERSION.
       The pack was upgraded and this mod has not been re-checked. Find the
       build for $MINECRAFT_VERSION, re-pin it in extra-mods.lock, and only
       then run this again."
  fi

  if [[ "$MODE" == "--remove" ]]; then
    if [[ -f "$target" ]]; then
      rm -f "$target"
      echo "  removed  $file"
    else
      echo "  absent   $file"
    fi
    continue
  fi

  # ── Already correct? ────────────────────────────────────────────────
  if [[ -f "$target" ]]; then
    actual_sha=$(sha256sum "$target" | cut -d' ' -f1)
    if [[ "$actual_sha" == "$sha" ]]; then
      echo "  ok       $file"
      continue
    fi
    # Not a hash we pinned. Never silently overwrite: somebody may have put a
    # deliberate build there, and the operator should know either way.
    echo "  WRONG    $file"
    echo "           expected $sha"
    echo "           actual   $actual_sha"
    problems=$((problems + 1))
    [[ "$MODE" == "--check" ]] && continue
    log "Replacing $file"
  else
    if [[ "$MODE" == "--check" ]]; then
      echo "  MISSING  $file"
      problems=$((problems + 1))
      continue
    fi
    log "Installing $file"
  fi

  # ── Download to a temp file, verify, THEN move into mods/ ────────────
  #
  # Downloading straight into mods/ would leave a partial jar there if the
  # transfer failed, and Forge loads whatever it finds at start.
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --progress-bar -o "$tmp" "$url" || die "download failed: $url"

  actual_size=$(stat -c%s "$tmp")
  [[ "$actual_size" == "$size" ]] \
    || die "size mismatch for $file: got $actual_size, expected $size"

  actual_sha=$(sha256sum "$tmp" | cut -d' ' -f1)
  [[ "$actual_sha" == "$sha" ]] \
    || die "SHA256 mismatch for $file — refusing to install.
       expected $sha
       actual   $actual_sha
       Note that CurseForge and Modrinth ship this mod under different hashes
       (they differ in META-INF/MANIFEST.MF). If you changed the URL, re-pin
       the hash from the source you actually intend to use."

  mv "$tmp" "$target"
  trap - EXIT
  echo "  installed $file"
  echo "            $actual_sha"
done

if [[ "$MODE" == "--check" ]]; then
  if [[ $problems -gt 0 ]]; then
    echo
    echo "$problems extra mod(s) missing or wrong — run without --check to fix."
    exit 1
  fi
  echo
  echo "all extra mods present and pinned"
fi

echo
echo "  mods : $(find "$MODS" -name '*.jar' | wc -l) jars in $MODS"
echo "  NOTE : the Game Server must be RESTARTED for a change here to take effect."
