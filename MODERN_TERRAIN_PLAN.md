# Modern terrain experiment

Branch: `experiment/modern-terrain`

Status: playable experimental implementation on this branch; verification is
recorded in [the implementation notes](oracle/MODERN_TERRAIN.md).

Implemented: a 2× terrain mask and presentation surface; four biomes; mountain,
cave and city layouts; painted backgrounds and textured material layers;
destructible sprite scenery; connected support and rubble; local/host setup;
versioned saved masks. Classic remains the default.

Experiment limits: animals are static destructible scenery; structural collapse
resolves into loose rubble without rigid-body animation. Tanks, the main battle
HUD and standard blasts now render at the higher resolution. Other effects retain
the logical-resolution overlay. All HTML screens share the modern theme. Some older weapon
raster operations modify one world pixel (a 2×2 group of terrain cells), while
terrain generation, circular craters and projectile contact use the finer grid.
LAN play already has one authoritative host simulation, so clients do not need
a second map generator or a new synchronization protocol.

## Goal and visual direction

Explore a modern 2D artillery landscape with finer destructible terrain,
distinct snow, desert, swamp and grass biomes, mountain/cave/city layouts,
and destructible scenery. Start with crisp illustrated shapes, textured soil
and rock, soft atmospheric backgrounds, and readable silhouettes. Keep tanks,
shots and aiming information conspicuous against every biome.

Make this an opt-in Modern mode alongside Classic. Modern terrain and scenery
are intentional new features, not DOS fidelity claims. Preserve Classic's
generation, RNG consumption and existing regression expectations.

## Findings from the current implementation

- `src/terrain.ts` stores a column-major pixel grid, not just a heightmap.
  Generation currently fills a midpoint-displacement or scanned `.MTN` surface.
  The grid can represent cavities, but placement and settling assume particular
  arrangements of soil and sky.
- `src/config.ts` defaults to a 1024×768 logical world. Rendering, terrain,
  projectile contacts, tank sizes and many weapon distances share pixel units.
  Raising `GRAPHICS_MODE` alone changes the battlefield's gameplay scale.
- `src/render.ts` composites the terrain through a palette into a logical
  surface; `src/main.ts` presents it to the visible canvas. A larger presentation
  canvas alone would not produce finer terrain geometry.
- `src/hazard.ts` already installs a simple cavern ceiling. Existing placement
  skips a top-attached ceiling, and settling has special treatment for it.
  Arbitrary cave rooms and arches need explicit support and spawn rules.
- `src/game.ts` and weapon effects access terrain directly. New collision and
  material representations require an audit of those callers, not just renderer
  changes. Saves currently serialize the terrain's dimensions and palette bytes.

## 1. Resolution and rendering foundation

Build a fixed-seed mountain prototype before expanding the content matrix.

- Separate world coordinates, terrain-cell coordinates and display pixels.
  Keep existing world dimensions, tank sizes, velocities and weapon radii.
- Prototype a Modern terrain grid with **two cells per world unit on each axis**.
  At a 1024×768 world this means a 2048×1536 mask. Generate at that resolution
  rather than enlarging the old mask. This is four times the cells, so measure
  generation, large craters, collapse, memory and frame cost before adopting it.
- Centralize world-to-grid conversions, including radius conversion, footprint
  queries and swept projectile contacts. Audit direct grid reads/writes and
  weapon-specific raster operations. Prevent fast shots skipping thin surfaces.
- Give the Modern renderer a display-resolution surface with capped device
  pixel ratio. Keep input mapping in world coordinates. Separate material IDs
  from rendered RGB colors; surface detail must never become accidental collision.
- Render layered rock/soil, edge shading and subtle deterministic texture.
  Cache terrain tiles and invalidate them on generation, carve, deposit, settle
  and load. Presentation-only particles and texture use separate randomness.
- Keep Canvas2D for this experiment; consider a different backend only if
  profiling identifies a limit that caching cannot resolve.

Acceptance: finer generated edges and crater contours are visible at 1080p;
the world scale and tank/weapon dimensions remain consistent; Classic outputs
are unchanged. Record timings on the actual test machine and target a 16.7 ms
frame budget during representative play, explicitly recording heavy-effect
spikes. If the finer mask is too expensive, keep it experimental and report
the limit rather than describing upscaled graphics as higher-resolution terrain.

## 2. Biomes on mountain maps

Treat **biome** (appearance and distribution of scenery) and **layout** (geometry)
as separate choices. Use one dominant biome per round initially; snowy peaks can
transition into bare rock or grass with elevation and slope.

- Snow: exposed rock faces, snow on upward-facing ledges, pale distant peaks.
- Desert: dunes, sandstone strata, warm haze, sparse dry vegetation.
- Swamp: low rolling ground, dark soil, reeds and mist. Water starts as clearly
  noninteractive background scenery; fluid simulation is outside this experiment.
- Grass: green surface cover, earth strata, rocky outcrops and scattered trees.

Use layered seeded noise for large landforms and smaller ridges, with bounded
slopes around spawn locations. Avoid uniform fine noise that obscures the shape
of a mountain. Surface treatments must update around fresh craters and deposits.

Acceptance: four recognizable playable mountain scenes, fixed seeds for visual
review, and readable shots/shields against bright snow and dark swamp backgrounds.

## 3. Cave and city layouts

- Mountains: retain familiar peaks and valleys as the initial/default layout.
- Caves: start with one broad connected chamber, a floor, a supported roof and
  generous firing clearance; then add side rooms, arches and stalactites.
  Validate tank spacing, empty footprints and usable firing space. Use explicit
  spawn anchors rather than assuming the first surface in a column is the floor.
- City: a ground profile with streets, lots, and varied skyscraper silhouettes.
  Distant buildings are background art; foreground buildings have visible
  collision shapes and participate in destruction. Start tanks on ground lots.
- Add a deterministic layout selector with explicit Mountain/Cave/City/Random
  options. Keep the first random pool mountain-heavy; tune weights after play.
  Bound generation retries and provide a known-playable fallback seed/layout.
- Introduce Modern support rules: loose soil settles, supported rock roofs and
  structures persist, and detached pieces resolve deterministically. Do not
  apply the Classic per-column soil collapse blindly to an entire cave or city.
  Start with grid/connected-component support and bounded collapse work, rather
  than a general rigid-body simulation.

Acceptance: playable starts across a seed corpus and supported tank counts;
explosions can open caves or undermine buildings without collapsing the entire
map after every shot, trapping spawned tanks, or hanging the simulation.

## 4. Destructible scenery

Introduce stable object IDs, placement footprints, collision masks, material,
health/damage state and support anchors. Rendering and combat must agree on
which parts of an object still exist.

- First trees and small houses: blast damage, visible breakage, and removal or
  bounded debris when destroyed or undermined. Share building rules with city
  structures; buildings must not merely disappear when the dirt beneath changes.
- Then parked cars: damaged/destroyed states. Secondary explosions are a later
  gameplay choice, not an implicit property of decorative cars.
- Then animals: optional ambient movement with simple non-graphic hit/flee
  behavior. Keep cosmetic animation independent of simulation RNG; synchronize
  any movement or hit response that affects gameplay.
- Define interactions for direct shots, blast radius, laser, burning effects,
  dirt deposition and terrain collapse. Debris starts cosmetic and cannot cause
  invisible obstruction. Add new collidable rubble only with explicit rules.
- Place props after safe tank locations are reserved. Density limits keep firing
  space readable and bound rendering/collision costs.

Acceptance: a normal fired shot can damage a prop; explosions and loss of support
produce consistent destruction; all relevant weapons finish normally; no stale
collision remains after removal and no prop overlaps a tank at spawn.

## 5. Integration and reproducibility

- Add a Modern/Classic selector, biome/layout choices and random selection to
  the existing setup UI, with sensible defaults and quality controls.
- Use a versioned map recipe: seed, generator version, biome, layout, world size
  and cell scale. Separate generation/scenery RNG streams from combat RNG.
- Extend saves for material masks, object state and generator metadata; migrate
  older saves as Classic. A restore must preserve damage, not regenerate an
  untouched scene from its seed. Validate dimensions and payload limits.
- Carry gameplay-affecting options and object state through online setup/state
  synchronization. Reject incompatible generator versions clearly. Render
  quality and device pixel ratio must not affect deterministic outcomes.
- Until saves and online support are implemented, expose early prototypes only
  through a local experiment harness with those limitations stated explicitly.

## Delivery order and verification

Each milestone should be independently reviewable on this branch:

1. Resolution prototype: one grass mountain, detailed rendering, one normal
   missile crater, and measurements before/after destruction.
2. Four mountain biomes, deterministic seed gallery and readable combat effects.
3. Trees/houses plus shared support and destruction primitives.
4. Playable cave and skyscraper city layouts using those primitives.
5. Cars/animals, setup controls, save compatibility and online integration.

For each code milestone, add focused tests for actual new behavior: coordinate
conversion/contact, generation determinism, spawn validity, support/destruction,
and persistence as applicable. Keep old DOS-backed cases intact and identify
Modern tests as browser feature tests. Never regenerate old expected results
from the implementation to conceal a regression.

Follow [the browser verification guide](test-browser/README.md), reusing one Vite
server. Run `run.mjs` for rendering and `weapons.mjs` for terrain/weapon changes;
run `ui.mjs` when controls change and the online drivers when networking changes.
Extend the harness with the fixed-seed scenes and inspect representative captures
before impact, during destruction and after settling. Include bright/dark biomes,
cave roofs, building supports, large explosions and simultaneous shots.

Run `npm test` and `npm run build` before submitting code. Record measured limits
and the exact scenarios checked; passing these checks does not establish DOS
parity for the modern mode. For this planning-only change, review file references
and commands and run `git diff --check`.
