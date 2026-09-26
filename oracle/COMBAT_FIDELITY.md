# Scorched Earth 1.5 combat port

Reference: the locally installed, unmodified 415,456-byte `SCORCH.EXE`, SHA-256
`05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f`.
The installed game and DOSBox configuration were not modified. Runtime checks
used a disposable copy under `/tmp`. The address convention is documented in
[WEAPON_FIDELITY.md](WEAPON_FIDELITY.md).

The original Python port misidentified several handlers. Its vectors remain
useful for unchanged subsystems, but incorrect instant explosions and guessed
weapon effects are no longer treated as reference behavior.

## Weapons and shared effects

| Original slots | Handler | Ported behavior |
| --- | --- | --- |
| 0–3 missiles/nukes | `4d1e:0021` | Grow, hold, palette cycle, dissolve, crater, then damage; large blasts use the recursive texture at `3869:0081/0266/03c1`. |
| 4 LeapFrog | `3382:0006` | Three successive blasts, radii 30/25/20; wait for cleanup before relaunching at velocity divided by 1.5. |
| 5 Funky Bomb | `2dce:0000` | Colored bursts and fixed-point curved trails; final blast uses the shared lifecycle. See the earlier weapon audit. |
| 6–7 MIRV/Death's Head | `35d5:0239` | Parent remains the central warhead, plus 4/8 children; retain all blast centers until the cluster lands. |
| 8–9 Napalm/Hot Napalm | `36e6:01a0` | Downward/sideways fluid spread, flame plumes, scorched dirt, separate per-emitter heat damage. |
| 10–11 tracers | `4d1e:0002` | No damaging explosion; Smoke Tracer retains its trail independently of TRACE. |
| 12–14 rollers | `3fbd:0003/027b` | Seek downhill gaps, move horizontally or fall one pixel, explode at an obstruction; honor wall modes. |
| 15–16 Riot Charge/Blast | `3f76:000d` | Immediate aimed wedge from the tank; sizes 36/60 and half-angles 45/60. |
| 17–18 Riot Bomb/Heavy Riot | `3f76:03bd` | Scaled terrain-clearing circles, with the riot siren. |
| 19–21 diggers | `251b:000a` | Branching tunnels, twice the absolute table budget; no Sandhog terminal charges or direction persistence. |
| 22–24 Sandhogs | `251b:000a` | Dirt-following branching tunnels and terminal charges; see the earlier audit. |
| 25–27 dirt spheres | `25a0:0009` | Growing deposits with unscaled radii 20/35/70; bury tanks without lifting them onto the mound. |
| 28 Liquid Dirt | `36e6:01a0` | Fluid algorithm with the original negative base value, -20; deposits terrain. |
| 29 Dirt Charge | `25a0:0081` | Ordinary projectile, then upward random dirt spray extending one third of the field height. |
| 30 Earth Disrupter | `262c:013e` | 100 brightness/speaker cycles, followed by forced animated collapse even at full dirt suspension. |
| 31 Plasma | `3770:0009` | Centered on its owner, charge 0–10 Batteries, textured blast, longer hold and blue cleanup; excludes owner and dirt, makes no crater. |
| 32 Laser | `3319:0004/0516` | Power-based energy, 40 per pixel plus 40 through dirt, small dirt cuts, ten-point damage pulses; Super Mag converts energy into shield recharge. |

`33a1:1061` applies explosion scaling only to selected families. At width 320,
scales are 0.5/0.75/1; other modes use 1/2/3. Standard blast damage is rounded
radial falloff multiplied by item index + 1, clamped above 100 to 110.

Plasma's min/max are the effective Missile/Nuke radius fields in the weapon
table, not unknown globals. Battery selector `DS:d556` is initialized by the
name lookup at `26b3:0177`. The charge chooser runs before consuming anything,
works in each play mode, and shares controls with the LAN controller. Cancel
and reconnect preserve ammunition and Battery counts.

Terrain settling now animates all unsupported runs while preserving their
shade order. Cavern ceilings and Suspend Dirt remain respected. Falling tanks,
parachutes, collateral deaths, and settling must finish before turn advancement.
Existing parachute geometry and shield deployment/repulsion are retained;
shield interception, Laser recharge, terrain burial and delayed damage use the
corrected weapon paths.

## Deaths, weather and sound

The eleven-case roulette at `271b:0005` now dispatches to live controllers:
thud; one/two/three escalating blasts; Funky Bomb; reflected spark rays;
Dirt Charge; six flame plumes; sinking dissolve; overlapping gray bubbles;
and hull-pixel dissolve. The sparks at `271b:0543` cause 20 damage within their
random 45–104 radius. The sink at `352c:00c9` chooses its depth from the floor
clearance and is excluded in Cavern. Gray bubbles come from `4451:016f`.
Hull pixels and barrel come from the tank design; `37d2:0392` supplies their
400 velocity multiplier, 40 gravity increment and 70 movement divisor.
Retreat retains its separate ascension sequence. Death entries retain their
shooter so later deaths in a shared volley receive the right credit.

Storm lightning at `480f:0219/0390/000c` starts at a random sky position, bends
and branches during the raster walk, stops at terrain or a tank, and inflicts
10 damage only on direct contact with HOSTILE_ENVIRONMENT enabled. It does not
select a nearby victim and then aim a decorative bolt at it.

The launch chirp at `2a4a:03d2` is 1000, 2500, 4000, 5500, 7000, 8500 and
10000 Hz; the old decompile omitted arithmetic. Riot uses the rising/falling
siren previously mislabeled Plasma. Dirt and Earth Disrupter generate their
own tones as their simulation advances.

## Evidence and limits

- `test/fixtures/dos_combat.json` is generated by
  `extract_combat_reference.py` from the SHA-verified table and constants,
  plus independent Python transcriptions of texture, charge and damage logic.
  It does not import the browser implementation or the historical game port.
  These are static fixtures, **not recorded DOS execution traces**.
- [dos-nuke.png](reference/combat/dos-nuke.png) is a real DOSBox framebuffer,
  captured during normal gameplay using `dos/capture.c`. It confirms the red
  textured blast and replaces the invented three-circle Nuke rendering.
  DOSBox was 0.74-3, surface output, fixed 20,000 cycles; the 720×480 capture
  doubles horizontal pixels of the selected 360-wide DOS mode.
- Browser randomness remains the existing seeded generator, as agreed. Identical
  seeds do not reproduce the DOS random stream. Frame pacing maps blocking DOS
  loops to the browser's 60 Hz simulation; audio durations are calibrated rather
  than reproducing its CPU-dependent busy waits.
- This is a behavioral port, not a claim of pixel-perfect DOS output in every
  video mode. Aspect correction at unusual resolutions, the Laser line raster,
  death-effect palette transitions, simultaneous overlapping effect masks and
  PC-speaker timing retain browser approximations. Only the Nuke has a newly
  retained DOS runtime screenshot in this audit; the other new handlers are
  backed by disassembly and regression tests. Funky/Sandhog evidence is in the
  earlier audit.

## Reproduce

```bash
python oracle/extract_combat_reference.py /path/to/SCORCH.EXE
npm test
npm run build
npm run dev
# In another terminal:
node test-browser/run.mjs http://localhost:5173
node test-browser/weapons.mjs http://localhost:5173
npm run test:online:browser
npm run test:online:production
```

The weapon browser check captures all 33 weapons on flat and sloped terrain,
checks completion and conserved soil during collapse, and writes PNGs plus
`test-browser/out/weapons/summary.json`. The render check exercises all eleven
death cases and the Plasma chooser. Unit tests cover all weapons in sequential,
synchronous and simultaneous modes, integer fixtures, cleanup, charge handling,
cluster waits, falls and kill attribution. LAN tests include Plasma selection,
cancel, charge consumption, player ownership and reconnect.

See [dos/README.md](dos/README.md) for the read-only disassembler and isolated
DOSBox capture adapter. Neither the executable nor a patched game image is
included in this repository.

Verification on 2026-09-26: `npm test` passed 15,724 tests in 62 files;
`npm run build` passed; all 43 render states and the final hull-debris check
passed; the 66 weapon/terrain sequences passed. Development LAN checks
(including Plasma charge/cancel/reconnect) and the production LAN browser test
also passed. The C reference tools compile with `-Wall -Wextra`.
