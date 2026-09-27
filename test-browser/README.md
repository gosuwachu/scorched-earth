# Browser verification

Run commands from the repository root. Install the locked dependencies with
`npm ci` if needed. The drivers use Playwright with system Chromium/Chrome when
available; set `CHROMIUM_PATH` to an existing browser executable if necessary.

## Choose the relevant checks

| Change | Driver | What it checks |
| --- | --- | --- |
| Shield physics, colors or lifecycle | `shields.mjs` | Flight outcomes, strength/fade pixels, and successive screenshots |
| Weapon effects or terrain interaction | `weapons.mjs` | Effect progression, completion, terrain settling, and screenshots |
| Canvas rendering | `run.mjs` | Render states, nonblank canvas, page errors, and render coverage |
| Menus, input or equipment controls | `ui.mjs` | Real DOM interaction, focus, responsive layout, and control behavior |

The canvas harness initializes controlled game states and advances the real
simulation/rendering code. Shield scenarios include both injected projectiles
and shots using the normal launch path. These checks do not replace the DOM
driver when changing how a player reaches or activates those states. The render
driver's coverage also does not establish application boot or online coverage;
use the corresponding existing suites when those paths change.

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

After the relevant checks pass, run `npm test` and `npm run build` for code
changes. Broaden or repeat verification only when another affected subsystem,
new edit or failure warrants it.

For comparisons against the original executable, follow the
[DOS capture guide](../oracle/dos/README.md). The original DOS game is the sole
fidelity reference. Do not run `visual/run_gate.sh` or generate Python-rendered
baselines for new comparisons; that workflow is [retired](../visual/README.md).
The full Vitest suite still includes legacy Python-derived fixtures, whose
passing results establish regression coverage rather than DOS accuracy.
