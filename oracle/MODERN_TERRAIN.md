# Modern terrain and interface experiment

This branch implements an intentional browser extension, not DOS fidelity.
Choose **Start → Terrain style → Modern**, or change the Landscape options.
Classic remains the default terrain. The HTML interface uses the modern theme
in both modes.

## Implementation

- Terrain depth combines painted sandstone, granite and soil materials with
  broad lighting inferred from the live ground mask. The paintings supply fine
  cracks, mineral grain, roots, stones and geological shelves; overlapping edge
  sampling avoids hard repeat seams. Materials stay anchored through excavation
  and save restoration. Generated originals and exact prompts are retained in
  `artwork/terrain-v3/`; runtime WebP materials live in `assets/modern/terrain-v3/`.
  Upper/left cut edges receive light and lower/right edges shade inward over at
  most thirty-two world units. A separate broad field shades whole cliff faces.
  Surface bands have irregular sand/turf caps, embedded grains and shaded lips;
  natural soil receives contact shadows underneath props. All solid shading
  stays inside the live material mask at half-unit resolution. Dirty tiles
  include their neighbors and every tile affected by changes to broad lighting,
  including changes far from a new cut. New desert maps have broader aprons,
  irregular upper benches and lower talus terraces, retaining their full height
  range, safe starts and asymmetric walls.
- Distant paintings receive a subtle biome-coloured haze. Natural cavities with
  both a roof and floor receive a soft, non-collidable rear shade, rebuilt from
  live cells after damage. Open overhangs and buildings do not create rear walls.
  Shadow opacity extends underneath solid terrain before filtering so smoothing
  cannot leave a bright gap along the cave contact edge.
  This is a procedural interpretation of the depth concept, not a reproduction
  of the generated painting. Existing painted backgrounds remain single images;
  there is no camera parallax or new independent middle-distance artwork.

- Terrain and its presentation use two samples per world unit on each axis:
  a 1024×768 game has a 2048×1536 material mask. Generation, circular craters,
  collision sampling and saved damage use this mask. A conservative world-pixel
  palette plane supports the existing weapon and movement code.
- Grass, snow, desert and swamp have distinct material treatments. Layouts are
  mountains, attached cave ceilings and cities. Random selection favors mountains.
  Mountain profiles use midpoint displacement with tall ridges and deep valleys
  across 75% of the screen height. A small smoothing filter softens thin surface
  spikes before normalizing the height range, preserving the broad relief.
  Desert mountain layouts instead generate two or three broad sandstone mesas:
  gently weathered caps, steep upper walls, small shoulders and sloping talus feet
  above sandy canyon floors. Heights are stratified from low terraces to tall
  mesas so every map has a visibly varied skyline. Each side has its own slope,
  cap width and ledge proportions, with small eroded shelves along the walls.
  The desert material uses painted warm sedimentary beds, shelves, interrupted
  fissures and directional face shading inspired by the terrain concepts.
  Sand highlights collect on shelves rather than outlining the cliff walls.
  Material details use stable world coordinates and remain aligned after damage
  and save restoration; the painted background remains non-collidable scenery.
  A thin soil cap covers solid rock; the same mask handles collisions, craters,
  settling and saves. Desert ground also carries seeded clusters of angular
  sandstone boulders and smaller rubble, with lit facets and bedding cracks.
  They avoid tank starts and existing scenery and share the destructible mask.
  Desert stones seat just half a pixel into the ground and stamp their complete
  faces over surface soil, preventing a sand strip from covering the lower rock.
  Unsupported stones retain their full volume when
  falling as rubble. Cave floors also have rugged relief. City streets follow gentler rolling hills,
  with individual building foundations extending to the ground below each lot.
- Painted backgrounds and soil textures combine with destructible trees,
  cottages and skyscrapers. City centres cluster very tall towers around a
  landmark, while suburbs use smaller houses and shops. Wide parks separate the
  districts; some crossings use a stone arch or Golden Gate-inspired suspension
  bridge over a real cut valley. Foundations support only actual structural feet,
  preserving open arches, spans and wheel spokes. The landmark pool includes
  stylised St Paul's, Big Ben, the London Eye, Bloomberg London, the Gherkin and
  a lighthouse, plus detached houses, 1930s semis and Victorian townhouses.
  All seventeen building types and the pine, willow and cactus use a matching
  painted sprite collection, with compiled alpha silhouettes. Both buildings
  and vegetation preserve their source proportions. Taller towers get wider
  plots; constrained plots or headroom shrink both dimensions together.
  An artwork tag retains earlier procedural/atlas rendering for existing saves.
  The suspension bridge uses twin-legged towers, cross-bracing and an open deck
  truss; these details belong to its destructible collision geometry too.
  City buildings are placed before tanks, with mixed ground/roof preferences
  and hull spacing preserved. Cars and animals are no longer generated. Old saved
  masks remain readable, including their original scenery. Atlas alpha masks are
  compiled into deterministic silhouettes shared by rendering and collision;
  new painted scenery uses connected 256×256 alpha masks from lossless textures.
  Detached scenery becomes sparse rubble. Dirt always settles vertically,
  regardless of Classic's Suspend Dirt setting. Rock and structures can bridge
  gaps when connected to grounded support or an attached cave ceiling; severing
  that connection makes them fall as rubble. Grounded dirt and rubble can carry
  rock above them, but cannot brace it sideways or hold up hanging dirt.
- Tanks, the main battle HUD and standard explosions render at the finer
  resolution. Tank previews share the same drawing code across setup, lobby
  and controllers. Modern launch position and hull clearance match the larger art.
- Explosion pixel writes now set alpha explicitly. Transparent effect layers
  previously hid blasts even though the simulation excavated their craters.
  Modern blasts add a bright core, glow, smoke and sparks without consuming RNG.
- The main menu, settings, player setup, shop, inventory, system dialogs,
  save/restore, results and remote controls share navy panels, cyan accents,
  readable text and keyboard focus. Targeting remains a transparent overlay.
- Versioned saves preserve the damaged fine mask and fractional prop geometry.
  Older saves load as Classic. Local and host setup expose the same choices;
  LAN uses its existing authoritative host simulation.

## Verification

The cave-contact correction checks flat and sloping roofs at all four fine-grid
alignments. Browser checks sample 36 first-air pixels after the same Canvas
upsampling used by the renderer; each retains shadow opacity above 180/255.
The six depth scenes also retain exact dirty/full-redraw and save-reload pixel
comparisons. Captures and verification logs are in `test-browser/out/cave-contact/`.
All 16,323 tests, the production build and eighty general render states passed
for this correction in a frozen source snapshot.

The painted-terrain update (2026-11-08) passed all 16,322 tests and the production
build in a frozen checkout snapshot, plus all eighty general browser render
states without crashes, blank frames or page errors. Its eighteen Modern integration scenarios
passed, and six depth scenarios passed exact cached/full-redraw comparisons
after excavation and settling, save-restored pixel equality, and render-only
collision-mask preservation. New unit checks cover continuous painted repeats,
broad-light invalidation far from a cut, and mesa shoulders at three map sizes.
The browser driver also decodes all three production WebP materials explicitly.
Inspected captures, integration logs and verified source hashes are retained in
`test-browser/out/painted-depth/`. First terrain renders and damage updates do
more work than cached frames; these checks are not a mobile performance claim.

The terrain-depth update (2026-11-08) was checked in a frozen source snapshot
while other work continued in the shared checkout. All 16,317 tests and the
production build passed, along with all eighty general browser render states.
The eighteen Modern biome/weapon/seed scenarios passed,
including normal firing, destruction and save-mask checks. The additional depth
driver checks six scenes (desert seeds 19/71, grass 19, snow 71, swamp cave 71,
city 19): cached frames match repeated frames, dirty-tile rendering after
excavation/settling matches a fresh renderer, restored saves render identically,
and rendering leaves collision cells unchanged. Representative intact and
damaged captures were inspected. Captures, logs, and source hashes are in
`test-browser/out/terrain-depth/`. These are browser regression checks, not
DOS fidelity evidence or proof of matching the generated concept art.

The desert geology update (2026-11-08) checks visibly separated mesa heights
and asymmetric slopes across six seeds, alongside the retained desert placement,
rock, destruction and save tests. The build, Modern browser driver and all 77
general render states passed. Four final desert scenes (1, 19, 71, 313) passed
firing, crater and save checks after the shading refinement; inspected captures
and reports are in `test-browser/out/desert-geology/final/`.
The latest full working-tree suite reported 16,299 passes and seven failures in
concurrent city-park/placement work; this is not a passing full-suite baseline.

The desert surface-occlusion fix passed all 16,291 tests, the production build,
and the Modern browser driver. Regression checks require the entire generated
rock face to remain stone where it overlaps surface sand, including after
settling; save masks are also compared. Inspected desert captures and the browser
report are in `test-browser/out/rock-surface-fix/`.

The desert-rock detail update passed all 16,291 tests and the production build.
`test/modern_rocks.test.ts` checks seeded placement, both boulder and rubble
sizes, tank clearance, mask restoration, excavation, and conservation of stone
volume when support is removed. The Modern browser driver checks rock presence
in the desert scene alongside its normal firing, destruction and save checks.
All 77 general render states passed. Final desert browser checks passed for
seeds 1, 19, 71 and 313, including explicit rock excavation and save restoration;
inspected captures and the report are in `test-browser/out/desert-rocks/`.

The desert-mesa update was checked in a frozen checkout snapshot on 2026-11-07.
Generation, cliff stability, excavation and mask restoration passed at three
resolutions across five seeds. Browser checks passed for seeds 1, 19, 71 and 313
with ten players, supported starts, normal missile impacts, craters and save
restoration; representative captures were inspected in
`test-browser/out/desert-mesas/`. The production build passed. The full suite
reported 16,264 passes and six failures in concurrent alpine-cave/placement and
city work, so this snapshot does not establish a passing full-suite baseline.

Verified on 2026-11-07: `npm test` passed 16,257 tests across 81 files;
`npm run build` passed. The render driver passed all 66 states, and the weapon
driver completed all 33 weapons on flat and hilly terrain plus its targeted
effect checks. The Modern scene, Modern application UI, full local UI, online
controller and production LAN drivers also passed. Representative menu, shop,
dialog, phone, terrain and explosion captures were inspected.

The subsequent rugged-terrain update passed 16,266 tests across 82 files and
the production build in a frozen checkout snapshot, avoiding reloads from
concurrent graphics edits. The Modern driver passed its six scenes, normal
weapon/explosion checks and three additional mountain seeds; the general render
driver passed all 77 states without crashes or blank frames. Representative
mountain, cave and city captures were inspected; results for this update are in
`test-browser/out/rugged-terrain/`.

The surface-smoothing follow-up also passed all 16,266 tests, the production
build and the Modern browser driver. It retains the full height range and
checks that narrow surface features cannot rise into tall needles. Inspected
mountain and cave captures are saved in `test-browser/out/smoothed-terrain/`.

The denser-city update passed 16,268 tests across 82 files, the production
build and all 77 general render states. The Modern browser driver covers rolling city ground, five building
styles, two-player rooftop firing/destruction/save restoration, and three
additional ten-player city seeds. Additional placement checks passed at
320×240, 640×480 and 1024×768 with two and ten players. Captures and reports
are saved in `test-browser/out/city-expansion/`.

The district/landmark update, including the reference-based Bloomberg and
St Paul's sprites, passed 16,291 tests across 86 files, the production build
and all 77 general render states.
The Modern integration driver and all 15 landmark specimens plus five
ten-player district captures passed. Checks cover real bridge openings, retained
structural support, loss of foundations, saved artwork tags, ground/roof starts
and tall/low building contrast. Final checks used an immutable source snapshot
while other terrain work continued in the shared checkout. Captures, logs and
the verified input manifest are in `test-browser/out/city-districts/`.

The cohesive painted-scenery update regenerates seventeen buildings and three
plant sprites. Original PNGs and exact built-in image-generation prompts are in
`artwork/buildings-v2/` and `artwork/props-v2/`; the asset README documents lossless
runtime compilation. Uniform scaling is checked when width, requested height or
map headroom constrains a sprite. Foundations seat uneven painted base stones
without filling bridge openings. Earlier saved artwork retains its original tag.
This update passed 16,298 tests across 86 files, the production build, all 77
general render states, all twenty
controlled scenery specimens and five ten-player city maps, plus the eighteen
Modern biome/weapon/seed scenarios. The general weapon driver also completed
all 66 flat/hill cases before the additional vegetation-only update. Captures,
logs and the verified source hashes are in `test-browser/out/painted-buildings/`.
These are browser feature/regression checks, not DOS fidelity evidence.

Run against one freshly started development server. Restart after editing source
before a full browser run: Vite hot-update URLs can create duplicate class
identities when a harness later dynamically imports an unversioned module.

```sh
HOST=127.0.0.1 PORT=4317 npm run dev:lan
node test-browser/modern.mjs http://127.0.0.1:4317
node test-browser/modern_ui.mjs http://127.0.0.1:4317
node test-browser/run.mjs http://127.0.0.1:4317
node test-browser/weapons.mjs http://127.0.0.1:4317
UI_TEST_URL=http://127.0.0.1:4317 node test-browser/ui.mjs
ONLINE_TEST_URL=http://127.0.0.1:4317 node test-browser/online.mjs
npm test
npm run build
node test-browser/online_production.mjs
```

`test/modern.test.ts` covers generation, safe placement, destruction, support,
fine collision, muzzle clearance, weapon completion and actual save bytes.
Existing DOS fixtures are unchanged. Repository tests also retain legacy
Python-derived regression coverage; they do not establish DOS parity.

`modern.mjs` captures six fixed-seed scenes before firing, during a normally fired
Baby Missile's growth/hold/erase, after impact and after structural damage. It
checks visibly changed opaque explosion pixels, completion and mask restoration,
then also checks Missile, Baby Nuke and Nuke. Three additional mountain seeds
check relief and the absence of cars/animals; three ten-player city seeds check
building variety, density and rooftop placement. `modern_ui.mjs` exercises native
setup controls, phone layout, application save/restore, input coordinate mapping
and the host configuration handoff. The online driver separately checks real
connections and controller ownership.

Captures and JSON reports are under `test-browser/out/modern/`; UI and online
captures are under `test-browser/out/`. These are browser checks, not DOS images.
Timing samples in `summary.json` cover generation, cached frames and destruction
for the tested scenes. Software Chromium timings are not frame-rate guarantees
on phones or other hardware.

## Current limits

Collapse resolves to rubble without rigid-body animation. Some older weapon raster operations still update a world pixel
(four fine cells), and secondary effects retain their logical-resolution overlay.
Materials do not yet have separate health or flammability.
Background paintings are decorative and cannot be hit. Artwork provenance and
mask compilation instructions are in `public/assets/modern/README.md`.

### Alpine hillside caves

Modern GRASS/SNOW mountain maps carve one or two seeded chambers of varied
width and height into downhill faces, with entrances that meet the hillside.
Two compressed ridge slopes form steep cliffs with weathered rock shoulders.
Their broad roots, rounded noses and chipped undersides vary by seed and
blend into the cliff face.
Round placement mixes safe cave-floor seats with surface starts when chambers
have enough hull/turret clearance and floor support. Placement falls back to
surface seats if a player's neighbourhood has no suitable cave. Roofs use the same
support/destruction mask as other rock; loose fragments settle during generation.
Cave openings have no interior backdrop or vegetation overlay; the distant
landscape shows through their empty collision space. Exposed rock stays bare. Existing saved masks
remain authoritative and are not regenerated.

`test/alpine_caves.test.ts` checks exterior connectivity, underground space,
the two-cave limit, size variation, steep cliffs, projecting ledges, stable
settling and mask save/restore for seeds 1, 19, 71 and 313 at
320×240, 640×480 and 1024×768, for both alpine biomes. `node test-browser/alpine.mjs http://127.0.0.1:4188`
captures eight alpine scenes and checks cave space, normal firing/destruction
and save roundtrips; `modern.mjs` also checks cave space in its biome sweep. These are
browser feature checks, with no DOS fidelity claim.

Alpine mountains scatter cool grey boulders and small scree fragments only on
cave floors beneath the ridge. They use the shared rock collision silhouettes,
with bare stone faces and pale caps on snowy maps. Placement uses flat cave
ledges, avoids tanks and other props, and rejects unsupported sites. Turf does not
cover embedded stone silhouettes. Rock masks are saved with the existing prop records and remain
weapon-destructible. `test/alpine_rocks.test.ts` checks seeded placement, mixed
sizes, tank clearance, support, destruction and damaged save restoration.
The eight scenes in `test-browser/alpine.mjs` also assert rock presence and no
rocks on the open surface.
