# Modern terrain and interface experiment

This branch implements an intentional browser extension, not DOS fidelity.
Choose **Start → Terrain style → Modern**, or change the Landscape options.
Classic remains the default terrain. The HTML interface uses the modern theme
in both modes.

## Implementation

- Terrain and its presentation use two samples per world unit on each axis:
  a 1024×768 game has a 2048×1536 material mask. Generation, circular craters,
  collision sampling and saved damage use this mask. A conservative world-pixel
  palette plane supports the existing weapon and movement code.
- Grass, snow, desert and swamp have distinct material treatments. Layouts are
  mountains, attached cave ceilings and cities. Random selection favors mountains.
- Painted backgrounds and soil textures combine with destructible trees,
  cottages, skyscrapers, parked cars and static deer. Atlas alpha masks are
  compiled into deterministic silhouettes shared by rendering and collision.
  Detached scenery becomes sparse rubble; supported natural terrain is retained.
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

Verified on 2026-11-07: `npm test` passed 16,257 tests across 81 files;
`npm run build` passed. The render driver passed all 66 states, and the weapon
driver completed all 33 weapons on flat and hilly terrain plus its targeted
effect checks. The Modern scene, Modern application UI, full local UI, online
controller and production LAN drivers also passed. Representative menu, shop,
dialog, phone, terrain and explosion captures were inspected.

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
then also checks Missile, Baby Nuke and Nuke. `modern_ui.mjs` exercises native
setup controls, phone layout, application save/restore, input coordinate mapping
and the host configuration handoff. The online driver separately checks real
connections and controller ownership.

Captures and JSON reports are under `test-browser/out/modern/`; UI and online
captures are under `test-browser/out/`. These are browser checks, not DOS images.
On this host, the six-scene software Chromium run measured roughly 16–19 ms
per cached frame, 182–336 ms for the initial render and 18–23 ms for the sampled
terrain destruction/settle operation, excluding its subsequent redraw. These
small samples are not frame-rate guarantees on phones or other hardware.

## Current limits

Animals are static scenery. Collapse resolves to rubble without rigid-body
animation. Some older weapon raster operations still update a world pixel
(four fine cells), and secondary effects retain their logical-resolution overlay.
Materials do not yet have separate health, flammability or car chain explosions.
Background paintings are decorative and cannot be hit. Artwork provenance and
mask compilation instructions are in `public/assets/modern/README.md`.
