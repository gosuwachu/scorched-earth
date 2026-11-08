#!/usr/bin/env bash
# Mechanical atlas extraction only; preserve generated colour and alpha.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/assets/modern/swamp-v1
for kind in plant root stalactite; do
  atlas="artwork/swamp-v1/${kind}s.png"
  read -r width height < <(magick identify -format '%w %h\n' "$atlas")
  cell_width=$((width / 2))
  cell_height=$((height / 2))
  for variant in 0 1 2 3; do
    x=$(((variant % 2) * cell_width))
    y=$(((variant / 2) * cell_height))
    output="public/assets/modern/swamp-v1/${kind}-${variant}.png"
    magick "$atlas" -crop "${cell_width}x${cell_height}+${x}+${y}" +repage "$output"
    # Almost invisible alpha noise must not enlarge the sprite placement box.
    bounds=$(magick "$output" -alpha extract -threshold 2% -format '%@' info:)
    magick "$output" -crop "$bounds" +repage "$output"
  done
done
