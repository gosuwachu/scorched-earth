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
Existing parachute geometry is retained. Shield outlines, palette changes and
swept contact handling use the original tier geometry and DAC arithmetic; see
the shield audits below. Laser recharge, terrain burial and delayed damage use
the corrected weapon paths.

## Gameplay feedback audit

- Liquid Dirt fills holes and smooths terrain; Earth Disrupter forces suspended
  earth to settle (manual lines 1184–1195). Disrupter is intentionally ineffective
  on settled terrain. The fluid routine `36e6:000b/007a/0448` has 100 reusable
  **active** queue slots, not a 100-pixel lifetime budget. Retire blocked parents
  immediately after deposition, and attempt allocation before that retirement.
  A flat surface can still exhaust the pool after 101 pixels. The reference
  well and narrow shaft instead deposit 381 pixels, reaching the 20-emitter
  limit with one sample per 20 deposits. Normal Napalm's limit is 15.
- Fuel color cycles during flow (`36e6:013e`). Flame geometry grows sequentially
  in `2d4f:014e`, with palette updates and heat damage after each emitter
  (`36e6:04eb..0699`), then 50 burn cycles. The browser exposes one row per
  simulation tick; this is a 60 Hz timing adaptation, not a measured DOS speed.
  Dirt deposition samples the active terrain shades (`323a:0bcb/0c20`); the
  browser derives that ascending shade table from its terrain pixels rather
  than carrying the DOS generation bitmask.
- MIRV and Death's Head impacts before splitting are intentional duds
  (`35d5:024a..026d`, manual lines 1065–1072). The check must precede direct
  damage and explosion audio. Force Shield reflection happens earlier in the
  original flight routine and does not count as a detonating impact.
- Ordinary shield interception costs exactly 10 points and cannot overflow
  into hull damage (`4d1e:0068`, `2dce:0047`, `35d5:02e2`). The historical
  Python shield analysis claiming there is no chip constant is incorrect.
  Force reflection separately costs rounded incoming speed / 100 and reduces
  speed to 70% (`2a4a:26ba..2734`).
- Shield contact is with painted outline pixels (`2a4a:1524..163a`), not the
  hull bounding box or a filled disk. `4912:09a9` centers outlines at the tank
  pivot: normal/Force radius 15, Heavy/Super Mag radii 16 and 15. Mag Deflector
  shows filtered overhead arcs at radii 13/16, and its arcs allow shots through.
  `shields.ts` shares the `4c70:026f` integer circle raster between collision and
  drawing. Own shields are bypassed; secondary heat still uses absorption.

`extract_feedback_reference.py` verifies the executable checksum and generates
`test/fixtures/dos_feedback.json`. It uses independent static transcriptions of
the queue and circle routines, plus flame-row fixtures for an injected zero
random stream. These are **not DOS execution recordings**. Regression tests
cover these pixels, impact behavior, stage timing and deterministic replays;
the browser harness captures successive flame rows and all shield tiers.

## Shield flight audit

The five definitions at `5f38:617c..61bc` give Mag Deflector 55 HP, Shield
100, Force Shield 100, Heavy Shield 150, and Super Mag 200. Equipment activation
sets the corresponding magnetic/reflection/laser flags. Absorbed blast damage
can exhaust any tier and overflow into hull damage; ordinary projectile
interception chips at most ten shield points without overflow. Super Mag
converts laser energy to shield charge, capped at 200; a depleted Super Mag
does not retain laser protection.

`2a4a:28b4..2a0d` applies magnetic lift to enemy shells with nonzero horizontal
velocity inside `abs(round(px - tank.x)) <= 15` and
`0 < round(tank.y - py) <= (height - 1) / 4` (integer height division).
Each callback adds `50 / FIRE_DELAY` to upward velocity, or 50 when the delay
is zero. Both magnetic tiers use the same push. Slow descending shots can turn
upward; a fast shot can penetrate the field. Mag Deflector's arcs do not stop
that shot, while Super Mag's ring can intercept it. Neither is a radial bounce.
The flight loop runs swept contact/Force reflection first, magnetic callbacks
second (`2a4a:120b..123c`), then the weapon predicate. Magnetic lift can therefore
prevent a MIRV from reaching apogee and splitting on that step.

Force reflection (`2a4a:2487..273d`) uses an upward-positive normal and the
incoming movement velocity saved before gravity, wind and drag (`e4dc/e4e4`).
The old browser path inverted velocity Y, so a top hit was mistaken for an
outgoing shot. The corrected vector reflection is mathematically equivalent
to DOS's doubled-angle rotation and preserves exact axial zero components.
It retains 70% of the speed and charges rounded incoming speed / 100 through
the ordinary damage gate, including hull overflow if the shield is exhausted.
The original quadrant guard remains for initial outgoing contacts. The browser
also suppresses revisiting the last reflected pixel while moving outward,
because its subpixel swept raster can include that pixel for several steps;
a later incoming return reflects and pays again.

`extract_shield_reference.py` verifies the executable checksum and generates
`test/fixtures/dos_shields.json` using independent static transcriptions of
magnetic motion and DOS's trigonometric reflection. These are **not DOS runtime
traces**. Magnetic samples explicitly use the existing browser timestep of
1/1920 second; the original CPU-adaptive cadence is not emulated, so identical
magnetic trajectories across arbitrary DOS machine speeds are not claimed.
Tests cover all tiers, field boundaries, complete slow/fast flights, reflection
and re-entry, depletion, laser recharge, and repeatable trajectories in all
three play modes. The shield browser gate captures actual successive frames
for all five tiers, including top and side Force contacts.

Shield audit verification on 2026-09-27: `npm test` passed 15,892 tests in
64 files; `npm run build` passed; the browser gates passed 13 shield flight
scenarios, 44 render states, and 66 weapon/terrain sequences. Shield captures
and trajectory samples are written to `test-browser/out/shields/`.

## Shield palette and normal-launch audit

The fixed browser blue has been replaced with the RGB fields at offsets
`+6/+8/+a` in the five definitions at `5f38:617c..61bc`. These are shield-type
colors, independently updated for each tank, not the tank's team hue:

| Tier | VGA RGB (0..63) | Full browser RGB |
|---|---|---|
| Mag Deflector | 63, 63, 23 | 252, 252, 92 |
| Shield | 63, 63, 63 | 252, 252, 252 |
| Force Shield | 63, 23, 63 | 252, 92, 252 |
| Heavy Shield | 63, 63, 63 | 252, 252, 252 |
| Super Mag | 63, 53, 33 | 252, 212, 132 |

`4191:0034` and `4191:06ca` scale each DAC channel using integer division:
`channel6 = base6 * HP / maximumHP`, truncated before expanding with `<< 2`.
The outline and browser status swatch share that color. The browser health bar
is placed above a visible shield so it cannot obscure the small Mag arcs.

Activation (`4191:0455`) has samples `i=0..50`: first compute
`level = floor(i*63/50)`, then `floor(base6*level/63)`. Collapse (`4191:0034`)
starts at full brightness and draws `floor(base6*(60-i)/60)` for `i=0..50`, then
erases the outline. Both use one sample per browser update (60 Hz), **not measured
DOS wall-clock timing**. The collapse snapshot keeps the shield type and position
after HP and equipment have been cleared; it never supplies collision protection.
Damage/recharge interrupts deployment, replacement starts a fresh fade, and
manual disable, round reset and save restoration discard obsolete animations.
The fixture extractor now records base colors, strength samples and every fade
sample directly from the checked executable and these static transcriptions.

The magnetic force itself did not need a magnitude change. New tests launch
actual enemy Baby Missiles instead of only injecting projectiles above a tank.
With default gravity, no wind, equal tank heights and shooter X=100:

- Target X=160, angle 60 degrees, power 180: an unshielded tank is hit; both
  magnetic tiers turn the descending shot upward and preserve full shield HP.
- Target X=430, angle 70 degrees, power 499: the shot penetrates the magnetic
  field. Mag Deflector's tank is hit; Super Mag intercepts it and loses 10 HP.

The unit tests exercise these flights in all three play modes. The browser gate
arms through the real control panel, fires through the normal launch path, and
records trajectories and successive frames. Faster shots can receive upward
acceleration yet keep descending, making the field less obvious during play.
The earlier caveat about DOS's machine-dependent callback cadence still applies.

The expanded shield browser gate passes 19 flight scenarios, all five palettes
and both 51-sample fades, plus manual deployment, damage, laser recharge,
replacement, collapse removal and terrain clipping. Pixel checks cover both the
outline and status swatch and confirm that changing team color leaves shield
color unchanged. Captures and `palette.json` are in `test-browser/out/shields/`.
Verification on 2026-09-27: `npm test` passed 15,923 tests across 64 files;
`npm run build` passed; the complete browser render gate passed all 44 states
with no exceptions or blank frames.

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
python oracle/extract_shield_reference.py /path/to/SCORCH.EXE
npm test
npm run build
npm run dev
# In another terminal:
node test-browser/run.mjs http://localhost:5173
node test-browser/weapons.mjs http://localhost:5173
node test-browser/shields.mjs http://localhost:5173
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
