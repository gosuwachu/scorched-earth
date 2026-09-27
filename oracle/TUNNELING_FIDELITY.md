# Ordinary projectile tunneling

Reference: Scorched Earth 1.5, 415,456-byte `SCORCH.EXE`, SHA-256
`05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f`.
Addresses follow [WEAPON_FIDELITY.md](WEAPON_FIDELITY.md). The executable,
installed configuration and guest memory were not modified. Runtime sessions
used disposable copies, normal input, and the read-only SDL memory sampler.

## Recovered rules

- `2a4a:1657..169a` permits penetration only with `DS:513a` (Tunneling) enabled,
  no tank/shield contact, nonzero projectile mode `+0x4a`, and no contact flag
  `+0x2e` (copied to `DS:1c76`). The former browser comment identifying `+0x4a`
  as the Contact Trigger was incorrect.
- `2a4a:169a..1714` multiplies both saved incoming velocity components
  (`DS:e4dc/e4e4`) by `DS:1d54 = 0.75`, **for every solid dirt pixel visited**.
  If the resulting squared speed is strictly below `DS:1d58 = 2000`, the weapon
  activates at that pixel. Equality survives. Otherwise that single pixel is
  replaced with background and the original swept segment continues. There is
  no time-based drag coefficient or automatic widening of the tunnel.
- `271b:0733..081a` walks both segment endpoints with integer Bresenham rules,
  taking the diagonal on an error tie. Flight starts from the previous rounded
  screen coordinate; the old browser's truncation could visit an extra pixel.
- `2a4a:0ecc..0f9b` commits the attenuated incoming velocity after the sweep,
  replacing that step's air-force updates, and sets mode `1`. Air viscosity,
  gravity and wind are skipped while mode is `1`. A subsequent sweep without
  penetration restores mode `-1` if its new continuous position differs from
  the previous integer position. Thus mode can resume airborne motion while
  traversing the pixel just cleared; it does not mean "inside a dirt region".
- `2a4a:0a1e..0a84` initializes rollers (12–14), tracers (10–11), and Dirt
  Charge (29) to mode `0`; other projectile handlers start at `-1`. Initial
  Digger and Sandhog shells can penetrate before their separate effects begin.
- `2a4a:08f6..0910` forces contact for non-ballistic guidance at spawn, before
  guidance acquisition. Ballistic guidance is exempt. Lazy Boy continues to
  use its separate callback. This costs no Contact Trigger inventory.
- `2a4a:2297..22a4` dispatches the original weapon handler regardless of the
  contact flag. A trigger changes where a Digger/Sandhog starts; it does not
  replace its effect with a plain explosion, or disable a roller's effect.
  Trigger flags survive MIRV splitting and the browser's LeapFrog effect
  controller/relaunch lifecycle.

## Browser configuration and validation

New configurations default to ON, as requested and as described in the DOS
manual's Tunneling entry. This intentionally differs from the binary's
no-configuration default of OFF. Explicit saved OFF values remain OFF.
The previously hidden Play Options toggle is available again, with inline help.

`test/fixtures/dos_tunneling.json` contains **static DOS transcriptions**, not
execution recordings. The extractor reads constants and handler pointers from
the checksum-verified binary and independently transcribes attenuation and
line-raster cases:

```bash
python3 oracle/extract_tunneling_reference.py /path/to/SCORCH.EXE
npm test -- test/tunneling.test.ts test/combat_effects.test.ts test/weapon_effects.test.ts
npm test
npm run build
```

Tests cover threshold equality, signed/diagonal motion, eligibility, single-pixel
clearing, rounded starts, subpixel revisits, mode transitions, exit/re-entry,
terrain impact dispatch, shields/tanks/floor, guidance, child/hop inheritance,
configuration roundtrips and deterministic spatial outcomes across play modes.
Superseded Python mode and impact expectations were removed, not regenerated.
Unrelated Python-derived tests remain legacy coverage only.

With one Vite development server, the weapon browser driver checks thick-soil
stopping, exit from a three-pixel barrier, OFF and Contact Trigger impacts.
It records intermediate canvas frames and `out/weapons/tunneling.json`.
The UI driver exercises the restored toggle and OFF roundtrip through actual
DOM input. Shield and rendering drivers check the shared collision/render paths.
Follow [test-browser/README.md](../test-browser/README.md) for commands.

## Recorded DOS observations and limits

`test/fixtures/dos_tunneling_runtime.json` retains read-only emulator samples,
initial tank state, configuration, observed calibration, timestep and live
projectile count. Capture PNGs are in `oracle/reference/tunneling/`. These
observations are separate from the static fixture and browser screenshots.

The retained underground-stop window is 433326–433422 ms in its process:
horizontal velocity drops from -547 to -54.76176452636719 (eight factors of
0.75) before impact completes. The ridge-exit window is 439352–439802 ms:
velocity drops from -547 to -97.354248046875 (six factors), then stays constant
while the shot travels left out of the ridge and across open sky. The OFF
window is 25304–25400 ms in a separate process; horizontal speed remains -76
through surface impact. The triggered window is 147523–148004 ms in another
process: `contact=1`, Tunneling ON, and horizontal speed -21 throughout impact.
Its initial sample precedes calibration (`dt=0`); subsequent samples record
calibration 202 and `dt=0.00009900990099009902`. Pixel counts inferred from these ratios corroborate
the static rule; they are not a recording of every collision callback.

The profile is DOSBox 0.74-3, normal core, fixed 20,000 cycles, SVGA S3, surface
output, logical 360×480 (720×480 framebuffer). The initial configuration uses
two humans, no wind/air viscosity, gravity 0.2, Fire Delay 100, and Trace ON.
Starting cash is zero for ON/OFF and $1,000,000 for the equipment session.
The exact configurations are retained in the runtime fixture. DOS terrain and
player angles are random; equal browser seeds do not reproduce these scenes.

For reproduction, use the [DOS capture guide](dos/README.md), a fresh directory
for each process, and unmodified executable/mountain assets. Start two human
players, inspect the aiming screen, and record before firing. Repeated shots
at the same ridge can open a passage: the retained exit observation followed
earlier impacts on that ridge. Buy Contact Triggers in Purchasing's
Miscellaneous category (Tab), then enable **Triggers** with `t` inside Tank
Controls before capturing a triggered shot. Confirm the sampler's `contact`
field rather than assuming a key press worked. Hold Escape for 100 ms when
returning to gameplay, inspect the aiming screen, then send a fresh held Space
command. The first equipment attempt confirmed the checkbox but did not produce
a triggered flight; only the subsequent confirmed flight is retained here.

The sampler runs at SDL event polls, at least 16 ms apart; it does not observe
each dirt pixel or the exact terminal threshold crossing. Samples can repeat
during the impact animation while the DOS slot remains active. Wall-clock
timestamps are not simulation time. Horizontal velocity changes in no-wind,
no-viscosity windows establish multiplicative attenuation; the exact strict
threshold and force ordering come from disassembly, not inferred end frames.

The browser retains its fixed timestep, muzzle geometry and tank silhouettes.
DOS's machine-dependent timestep affects vertical acceleration between cleared
pixels and the grouping of multiple contacts in a sweep. These checks do not
establish identical full trajectories, timings, terrain generation or full-game
pixel parity. No Python game output is used as new fidelity evidence.

Verification on 2026-09-27: 15,971 tests in 66 files passed; production build
passed. Browser checks passed 66 weapon/terrain combinations plus four ordinary
penetration cases, 22 shield-flight scenarios, 44 render states, and the actual
settings UI flow. Representative penetration frames were visually inspected.
