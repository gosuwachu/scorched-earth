# Browser verification

Run commands from the repository root. Install the locked dependencies with
`npm ci` if needed. The drivers use Playwright with system Chromium/Chrome when
available; set `CHROMIUM_PATH` to an existing browser executable if necessary.

## Choose the relevant checks

| Change | Driver | What it checks |
| --- | --- | --- |
| Shield physics, colors or lifecycle | `shields.mjs` | Flight outcomes, strength/fade pixels, and successive screenshots |
| Weapon effects or terrain interaction | `weapons.mjs` | Effect progression, completion, terrain settling, and screenshots |
| Modern tank designs | `tanks.mjs` | Seven distinct same-colour designs at battle/preview sizes and three aiming angles |
| Canvas rendering | `run.mjs` | Render states, nonblank canvas, page errors, and render coverage |
| Menus, input or equipment controls | `ui.mjs` | Real DOM interaction, focus, responsive layout, and control behavior |
| Modern terrain and artwork | `modern.mjs` | Six biome/layout scenes, extra mountain/city seeds, dense blocks and rooftop starts, visible missile/nuke blasts, destruction, save masks and timings |
| Terrain depth and lighting | `terrain_depth.mjs` | Cave-shadow contact after Canvas smoothing at 36 roof-edge positions; six scenes with identical cached/full redraws after excavation and settling, identical restored-save rendering, unchanged collision masks during rendering, captures and timings |
| Painted scenery and city districts | `city_landmarks.mjs` | Twenty building/vegetation specimens, preserved proportions, connected silhouettes, six ten-player district maps, planted playgrounds and a sports park, mixed ground/roof starts and height contrast |
| Alpine caves and overhangs | `alpine.mjs` | Eight grassy/snowy scenes, open cave space, firing, destruction and save roundtrips |
| Modern particle explosions | `modern_blast.mjs` | Growing crater visibility, moving/repeatable particles, plasma terrain preservation and unchanged collision cells |
| Modern setup and application integration | `modern_ui.mjs` | Setup, phone layout, actual save/restore, logical input mapping and host handoff |

All Modern drivers accept the development-server URL as their first argument.
See [the experiment notes](../oracle/MODERN_TERRAIN.md) for commands and limits.
Restart the development server after source edits before full browser runs so
hot-update module URLs cannot create duplicate class identities in dynamically
imported harness modules.

The canvas harness initializes controlled game states and advances the real
simulation/rendering code. Shield scenarios include both injected projectiles
and shots using the normal launch path. These checks do not replace the DOM
driver when changing how a player reaches or activates those states. The render
driver's coverage also does not establish application boot or online coverage;
use the corresponding existing suites when those paths change.

Online lobby, connection and controller changes use `online.mjs`. It starts a
development server with WebSocket support unless `ONLINE_TEST_URL` is set.
To share that server with the UI and render checks, start it once:

```bash
HOST=127.0.0.1 PORT=4317 npm run dev:lan
```

Then run the relevant drivers against it:

```bash
ONLINE_TEST_URL=http://127.0.0.1:4317 node test-browser/online.mjs
UI_TEST_URL=http://127.0.0.1:4317 node test-browser/ui.mjs
node test-browser/run.mjs http://127.0.0.1:4317
```

The online checks interrupt the initial join before the controller receives its
token, verify recovery after a reload and with storage blocked, and remove
disconnected first/middle lobby entries. They check stable player colours and
input ownership through shopping, battle and subsequent rounds. Representative
captures are `test-browser/out/online-colours-{lobby,shop,battle,round-two}-{host,phone}.png`.
The sprite assertions compare phone pixels with the host tank's palette colour;
these are browser consistency checks, not DOS visual comparisons.

Online shopping checks also purchase from two controllers before either presses
Done, exercise one player's inventory while another buys, switch the host's
Shopper selector, and reconnect to the independent shop. Both sequential and
simultaneous battle modes are covered, including subsequent rounds. Captures are
`test-browser/out/online-concurrent-shop-{sequential,simultaneous}-{host,alice,bob}.png`.
These check browser interaction and state ownership, not DOS fidelity.

Comeback economy checks run through `ui.mjs` and `online.mjs`. The local driver
selects the mode, checks the Greedy restriction, completes a controlled duel,
and verifies the shop income breakdown and responsive layout. The online driver
selects Comeback in the host lobby and checks matching host/controller income
after a round and a controller reload, without duplicate credits. Captures include
`ui-comeback-{setup,winner-shop,recovery-shop,mobile-shop}.png` and
`online-comeback-{lobby,shop-host,shop-phone}.png` under `test-browser/out/`.

## Reuse one development server

Start Vite in a persistent terminal or tool session:

```bash
npm run dev -- --host 127.0.0.1 --port 4188 --strictPort
```

From another terminal, run only the relevant drivers against that checkout:

```bash
node test-browser/shields.mjs http://127.0.0.1:4188
node test-browser/weapons.mjs http://127.0.0.1:4188
node test-browser/run.mjs http://127.0.0.1:4188
UI_TEST_URL=http://127.0.0.1:4188 npm run test:ui:browser
```

Always supply the URL: driver defaults differ. Use a development server because
the harness imports source modules; `vite preview` serves the production bundle.
If port 4188 is occupied, confirm it serves this checkout before reusing it, or
choose another port and pass its URL consistently. Stop the server you started
when finished, by its session or recorded PID.

For a standalone render check, `bash test-browser/run.sh` manages its own server.
For a standalone DOM check, `npm run test:ui:browser` starts its own server when
`UI_TEST_URL` is unset. Neither requires starting another server manually.

## Read the evidence

Screenshots and reports are written under `test-browser/out/`; shield and weapon
drivers have `shields/` and `weapons/` subdirectories with `summary.json` files.
Shield palette samples are in `shields/palette.json`. Inspect representative
frames around the interaction and the numeric outcomes, not just a final image.
Runs reuse output paths, so preserve any needed before/after captures separately
and use the latest summary to identify the scenarios that actually ran.

The render driver checks the browser's 150 ms missile streak with explicit
timestamps. `trail_dark.png`, `trail_bright.png`, `trail_fade.png`, and
`trail_expired.png` capture its visibility and expiry; `flight.png` shows a normal
launched shot. The assertions cover pixel blending, invisible/excluded shots,
scene resets, edge jumps, and the independent persistent TRACE/Smoke Tracer paths.
These are browser visibility checks, not DOS visual comparisons.

Off-screen missile indicators are covered by `indicator_dark.png`,
`indicator_bright.png`, `indicator_no_hud.png`, and `indicator_target_hud.png`.
The checks cover all edges/corners, grouped missile counts and nearest-distance
labels, and unchanged HUD/wind pixels. `indicator_rules` checks invisible and
non-airborne exclusions, grouping/separation, re-entry, removal and round resets.
`indicator_flight.png` and `indicator_return.png` follow a normally fired high
shot through exit and re-entry, checking that rendering leaves its trajectory
unchanged. Distances are logical game pixels, independent of browser scaling.

The weapon driver also writes `weapons/simultaneous.json` and
`weapons/simultaneous-*.png`: an underground explosion collapses while another
shot stays airborne, with unchanged shot coordinates during the fall and resumed
flight afterward. The assertions check animated falling, conserved soil, and
complete settling without requiring an empty battlefield.

The weapon driver fires Laser through the normal launch path at powers 200, 500,
and 800, checking beam lengths in air and continuous dirt, ammunition consumption, and shooter
health. It writes `weapons/laser-range.json` and `weapons/laser-range-*.png`.
These cover the browser's intentional approximately 2.67x range adjustment, not DOS parity.
Travel and extra dirt-cutting energy costs are both 15, compared with the original 40.

After the relevant checks pass, run `npm test` and `npm run build` for code
changes. Broaden or repeat verification only when another affected subsystem,
new edit or failure warrants it.

For comparisons against the original executable, follow the
[DOS capture guide](../oracle/dos/README.md). The original DOS game is the sole
fidelity reference. Do not run `visual/run_gate.sh` or generate Python-rendered
baselines for new comparisons; that workflow is [retired](../visual/README.md).
The full Vitest suite still includes legacy Python-derived fixtures, whose
passing results establish regression coverage rather than DOS accuracy.

Laser Sight is browser-only equipment: Miscellaneous sells ten charges for a base
price of $2,500. It automatically shows a straight, 100-pixel fading extension of
the barrel while a human aims and consumes one charge per launched shot (including
salvos). Unused charges carry between rounds and saves; original 48-item saves
load with zero charges. This is a direction aid, not a gravity/wind prediction.

The render driver captures `laser_sight_{black,plain,modern}_{0,17,45,90,135,163,180}.png` and
checks decreasing pixel contrast along the beam, no beam beyond its endpoint,
and no inventory mutation during rendering. Modern captures also check the sight's
origin against the scaled artwork muzzle. Classic sights start at the centre of
the rounded muzzle pixel. The DOM driver buys the item from
Miscellaneous, verifies the price/count and painted icon, and saves
`ui-laser-sight-shop.png`. Unit tests cover depletion, synchronous/simultaneous
launches, remote controller ownership, and save migration. These are browser
feature checks, not DOS fidelity evidence.

Modern missiles use a velocity-oriented rocket with warm exhaust and a soft,
500 ms smoke trail. `trail_modern_rocket.png`, `trail_modern_smoke.png`, and
`trail_modern_expired.png` cover both flight directions, residue after removal,
and expiry. The render checks verify visible artwork and unchanged velocity/TRACE
state. Classic mode retains its 150 ms streak; these are browser artwork checks.

`parachute_modern.png` and `parachute_classic.png` capture a controlled descent
through each renderer and check that drawing preserves tank state. Modern uses
a smooth shaded canopy and fine rigging; Classic retains its pixel artwork.
These are browser artwork checks, not DOS comparisons.

Modern tank artwork checks run with `node test-browser/tanks.mjs http://127.0.0.1:4188`.
The driver writes `test-browser/out/tank-designs.png` with all seven designs at
30, 90 and 150 degrees, including small battle-size samples. It also checks the
seven picker previews and clicks each human-selectable design, capturing
`test-browser/out/tank-picker.png`. These are browser
artwork checks, not DOS comparisons; appearance IDs and gameplay rules are unchanged.
