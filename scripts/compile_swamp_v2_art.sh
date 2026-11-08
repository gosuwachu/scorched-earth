#!/usr/bin/env bash
# Full-frame paintings stay intact. Only the moss sprite atlas is cropped.
set -euo pipefail
cd "$(dirname "$0")/.."
magick artwork/swamp-v2/ground.png -quality 93 public/assets/modern/terrain-v3/swamp-ground-v2.webp
magick artwork/swamp-v2/turf.png -quality 93 public/assets/modern/terrain-v3/swamp-turf.webp
read -r width height < <(magick identify -format '%w %h\n' artwork/swamp-v2/moss.png)
cell_width=$((width / 2))
cell_height=$((height / 2))
for variant in 0 1 2 3; do
  x=$(((variant % 2) * cell_width))
  y=$(((variant / 2) * cell_height))
  output="public/assets/modern/swamp-v1/moss-${variant}.png"
  magick artwork/swamp-v2/moss.png -crop "${cell_width}x${cell_height}+${x}+${y}" +repage "$output"
  bounds=$(magick "$output" -alpha extract -threshold 2% -format '%@' info:)
  magick "$output" -crop "$bounds" +repage "$output"
done
