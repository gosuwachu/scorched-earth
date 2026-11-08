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

- `terrain-v3/desert-{sand,cliff,beds,deep}-v3.webp`: four painted desert zones,
  composited as rough bedrock, rolling sediment beds, a broad sand plane, and
  separate mesa cliffs over the sand. Each layer has its own seeded contour;
  textures and boundaries remain fixed under excavation and save restoration.
- `desert-v1/{shrub,rock,adobe,truck}.png`: transparent decorative scenery,
  drawn after terrain, including inside the broad sand plane, only where the
  full root/base footprint meets visible live sand. These add no
  collision cells or foundations and disappear when support is excavated.
  Original built-in imagegen atlases and exact prompts are retained in
  `artwork/desert-v1/`. Runtime sprites are alpha-preserving atlas crops; terrain
  legacy crops use WebP quality 93. These assets are browser artwork, not DOS evidence.

- `cave-v1/{ground,topsoil,ceiling,stalactite}.png`: four strips extracted from
  a built-in imagegen material atlas, using the user's swamp concept crops as
  style references. Original atlas and exact prompt: `artwork/cave-v1/`.
  The strips contain solid materials without concept labels or background air.
  Separate soil, stratified ground, ceiling and shaded stalactite treatments
  replace granite in swamp biomes and cave layouts. Layer anchors derive from
  saved collision cells; artwork does not change those cells.

The swamp cavern now uses `CaveLayers` to place broad earth banks, one buried
limestone bed and three overlapping ceiling sheets. Contact shadows and lit
edges are baked into the cached ceiling raster only; ground beds have even
illumination. Texture coordinates remain in world space; excavation clips the
layers without warping the paintings. Generated plant, root and stalactite
variants use sparse seeded placements. This is a browser artwork feature,
not a DOS fidelity comparison.

All four desert terrain materials now use independent full-frame 4:3 paintings:
golden sand, ledged sandstone cliffs, thin sediment beds and fractured red
bedrock. Each generated source is natively 1448×1086 (2048×1536 requested).
The renderer maps each complete image once across the world raster, then clips
it to its layer. There is no tiled repeat, seed shift, or stretching around
the layer boundary. Originals and exact built-in imagegen prompts are retained
in `artwork/desert-v3/`. `python scripts/compile_desert_art.py` transcodes them
at WebP quality 93 without cropping or resizing. The older atlas and v2
bedrock remain archived; the distant desert backdrop and scenery sprites are
separate assets.

- `swamp-v1/{plant,root,stalactite}-{0,1,2,3}.png`: twelve alpha-preserving
  sprite crops from three built-in imagegen atlases. Original atlases and exact
  prompts are retained in `artwork/swamp-v1/`; reproduce the extraction with
  `bash scripts/compile_swamp_art.sh` (ImageMagick). Each category has four
  different silhouettes. Sparse seeded placements vary scale and position;
  stalactite bases are hidden behind the matching ceiling sheet. Decorative
  sprites do not alter collision cells. Ground layers have no contact shadows;
  the ceiling keeps its recessed-layer shadows.

- `terrain-v3/swamp-ground-v2.webp`: a new complete 4:3 underground painting,
  mapped once across the world with `fullFrameMaterial`, like desert deep rock.
  The limestone seam and moss pockets are painted into this image; no tiling,
  seed offsets, column warping or added ground-layer contact shadows.
- `terrain-v3/swamp-turf.webp`: painted grassy moss used inside a seeded,
  variable-thickness turf sheet. It follows the original cavern surface and is
  clipped by live natural soil, so excavation does not grow grass in a crater.
- `swamp-v1/moss-{0,1,2,3}.png`: four generated transparent hanging-moss variants,
  with at most three crevice placements per cavern. Stalactites are enlarged;
  plant placement has up to eight clumps, including one or two larger specimens.
  New original paintings, moss atlas and exact built-in imagegen prompts are in
  `artwork/swamp-v2/`. Rebuild runtime assets with
  `bash scripts/compile_swamp_v2_art.sh` (ImageMagick). Ground/turf conversion
  retains each complete painting; only the moss atlas is cropped.
