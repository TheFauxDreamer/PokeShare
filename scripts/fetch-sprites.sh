#!/usr/bin/env bash
# Fetch Gen 3 Pokemon sprites into packages/web/public/sprites/.
#
# Source: PokeAPI/sprites, generation-iii/emerald — the community-standard set,
# and era-correct for a Gen 3 tracker. Files are named by National Dex number,
# which is exactly what the overlay looks up. See NOTICE.md for the licensing
# position.
#
# Idempotent: existing files are skipped, so re-running only fills gaps.
set -uo pipefail

BASE="https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/versions/generation-iii/emerald"
OUT="$(cd "$(dirname "$0")/.." && pwd)/packages/web/public/sprites"
LAST_DEX=386
PARALLEL=16

mkdir -p "$OUT"

fetch() {
  local dex="$1" out="$2"
  [ -s "$out/$dex.png" ] && return 0
  /usr/bin/curl -sfL --max-time 20 -o "$out/$dex.png" "$BASE/$dex.png" \
    || { rm -f "$out/$dex.png"; echo "MISS $dex"; }
}
export -f fetch
export BASE

seq 1 "$LAST_DEX" | xargs -P "$PARALLEL" -I{} bash -c 'fetch "$@"' _ {} "$OUT"

have=$(find "$OUT" -name '*.png' -size +0 | wc -l | tr -d ' ')
echo "sprites present: $have / $LAST_DEX"
[ "$have" -eq "$LAST_DEX" ] || exit 1
