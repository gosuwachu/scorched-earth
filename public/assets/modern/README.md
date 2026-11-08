# Modern artwork

Original generated artwork made for this experiment with the built-in imagegen
skill/tool. These are game assets, not DOS captures or fidelity references.

- `alpine.png`, `desert.png`, `swamp.png`, `cave.png`, `city.png`: distant,
  non-collidable environment paintings. Foreground geometry is generated separately.
- `earth.png`: mineral/soil texture; the renderer tints it by material and biome.
- `terrain-v3/{sandstone,granite,soil}.webp`: detailed painted material sections,
  generated with the built-in imagegen tool. Originals and exact prompts are in
  `artwork/terrain-v3/` (`provenance.json` and `soil-prompt.txt`). Runtime files
  use WebP quality 93. `terrain_material.ts` blends overlapping image edges for
  continuous repeats, with world-anchored sampling and seed offsets. Fine
  fractures and mineral detail come from these paintings; live-mask lighting,
  surface caps, contact shadows and destruction are rendered separately.
  They never supply collision geometry. Original procedural colours remain the
  fallback while artwork loads or if an asset is unavailable.
- `buildings-v2/*.webp`: seventeen matching painted building sprites, including
  the cottage, skyscrapers, city landmarks, bridges and suburban houses. All use
  the same muted stone/slate palette, soft brush texture and upper-left light.
  Original generated PNGs and exact prompts are in `artwork/buildings-v2/`.
  `python scripts/compile_scenery_art.py` losslessly transcodes the originals
  and compiles their alpha into `src/building_masks.json`; it checks decoded
  RGBA equality and keeps the connected structural silhouette. Generation and
  rendering sample this same mask. Each building preserves its source aspect
  ratio, including when a plot or map headroom limits its size. Taller towers
  occupy wider plots instead of stretching their facades.
- `props-v2/*.webp`: matching painted pine, willow and cactus sprites, with
  originals and exact prompts in `artwork/props-v2/`. Compile with
  `python scripts/compile_scenery_art.py props`. Plant silhouettes are stored
  in `src/plant_masks.json` and share the building sampling/rendering pipeline.
  Vegetation also scales uniformly, including park trees and mountain props.
- `bloomberg.png`, `st_pauls.png`: earlier transparent building sprites generated
  with the built-in image tool from the user's architectural references. Exact
  prompts are in `landmarks_provenance.json`. `scripts/extract_landmark_masks.py`
  compiles their alpha into 256×256 silhouettes in `src/landmark_masks.json`.
  Retained for existing saves tagged `illustrated-v1`; new maps use `painted-v2`.
- `props.png`: transparent sprite atlas. Rows contain pine/willow/cactus/cottage
  and tower/car/deer/shack. Retained for existing saves; new plant and building
  scenery uses v2. Older masks remain available for reading saved maps.
- Earlier city offices, apartments, shops, warehouses, landmarks, bridges and
  house styles used procedural half-unit silhouettes in `src/city_shapes.ts`
  and facade artwork in `src/modern_buildings.ts` and `src/landmark_art.ts`.
  These original code-drawn facades use no downloaded photographs or logos;
  They remain as legacy rendering and a loading fallback. Painted facades are
  also rendered directly from destructible cells, so craters remove their art
  and collision together.
- `provenance.json`: generation specifications.

`python scripts/extract_modern_masks.py` reads alpha from the atlas and writes
`src/modern_masks.json`. It requires Pillow. This is an asset compilation step,
not a regression fixture generator. It records crop bounds and 128×128 binary
silhouettes. Both rendering and generation use those exact samples, so image
load timing and browser image resampling cannot affect collision or saves.

- `terrain-v3/desert-{sand,cliff,beds}.webp` and `desert-deep-v2.webp`: four painted desert zones,
  composited as rough bedrock, rolling sediment beds, a broad sand plane, and
  separate mesa cliffs over the sand. Each layer has its own seeded contour;
  textures and boundaries remain fixed under excavation and save restoration.
- `desert-v1/{shrub,rock,adobe,truck}.png`: transparent decorative scenery,
  drawn after terrain, including inside the broad sand plane, only where the
  full root/base footprint meets visible live sand. These add no
  collision cells or foundations and disappear when support is excavated.
  Original built-in imagegen atlases and exact prompts are retained in
  `artwork/desert-v1/`. Runtime sprites are alpha-preserving atlas crops; terrain
  crops use WebP quality 93. These assets are browser artwork, not DOS evidence.

`terrain-v3/desert-deep-v2.webp` replaces the original deep-rock atlas strip
with a full-frame 4:3 painting of flat red sandstone slabs and fine fractures.
The generated source is 1448×1086; the renderer maps it once across the complete
world raster at any game resolution, then clips it to the bottom layer. There
is no tiled repeat, seed shift, or stretching around the layer boundary. The
original, user reference and exact built-in imagegen prompt are retained in
`artwork/desert-v2/`. `python scripts/compile_desert_art.py` transcodes it at
WebP quality 93 without cropping or resizing.
