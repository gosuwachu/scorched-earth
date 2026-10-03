# Scorched Earth 1.5 guidance

Reference: the original, unmodified `SCORCH.EXE`, SHA-256
`05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f`.
Addresses use the convention in [WEAPON_FIDELITY.md](WEAPON_FIDELITY.md).
The old Python guidance vectors used guessed velocity blends, an 80-pixel
Heat radius, and a wind-free launch solve. They are superseded for this subsystem.

## Behavior checked directly in the executable

| System | DOS behavior | Evidence |
| --- | --- | --- |
| Selection | Fire opens Choose Target for Ballistic, Horizontal, Vertical and Lazy Boy. Heat needs no selection. Simultaneous disables guidance. | `38b5:0fe1..1101` |
| Target | Digits select living tanks from left to right (0 selects the tenth); the point is the tank's base. Left-click chooses a point; right-click chooses a tank within 100 pixels. | `1a69:0002..02b0`, `1a69:02b1` |
| Inventory | An owned compatible accessory is spent once per shot, and the selector resets to None. MIRV, Death's Head, Riot Charge, Riot Blast and Plasma do not spend it. | `3a16:1530..15a5`, `38b5:11c8`, SCORCH.DOC pp. 29–30 |
| Heat | At swept pixels, acquire the first live non-owner in tank-array order with rounded distance strictly below 40. Teammates are not excluded. Copy its base coordinates; do not continually reacquire. | `2e50:0001..00ce`, `2a4a:1912..19d8`, `DS:5186` |
| Horizontal | Acquire at the selected row. On ascent, check the horizontal lane for obstacles; descent permits direct acquisition. Preserve velocity and install the steering callback. | `2a4a:17a7..1855`, `4bac:010c/022c` |
| Vertical | Acquire at the selected column, including when below the selected point. Preserve velocity and install the steering callback. | `2a4a:185b..190c` |
| Steering | Add target delta times `k * dt / sqrt(distance)`: k=10,000 for Heat/Vertical, 15,000 for Horizontal. Skip the acceleration at distance-squared below 0.001. Crossing an enabled target axis releases Heat steering or detonates Horizontal/Vertical. | `2e50:099c/0c30`, `DS:321c/3224/3228` |
| Ballistic | Rotate into the effective gravity axis, including wind/2000. Solve power at the chosen angle, without viscosity correction. The human branch takes the absolute squared speed for impossible geometry, then the UI clamps power to health × 10. This is deterministic, not random. | `2e50:05e9..099b`, caller at `38b5:107d` |
| Lazy Boy | Replace ordinary integration with major-axis DDA movement toward a fixed point, budgeted at 500 steps per second. Climb around soil/other tanks; the selected tank is exempt from avoidance. Excavate soil remaining in the escape direction. Detonate on tank contact or the chosen pixel, including empty air. This callback bypasses shield interception and magnetic force. | `2e50:00cf..05e8`, `DS:31fc` |

Ordinary shield/tank/terrain contact precedes swept guidance acquisition.
Force reflection and magnetic callbacks retain the existing combat order.
Lazy Boy uses its separate DOS callback path.

The browser now applies the documented health × 10 power limit to ordinary
aiming and firing as well as Ballistic guidance, for local and online humans
and AI in all three play modes. Hull damage immediately lowers an excessive
selection; Batteries raise the available maximum without raising the selection.
Saved games and pending target requests are clamped against current health when
restored. `test/power.test.ts` and the local/online browser input checks cover
these integration rules. This reuses the static DOS evidence above; it is not
a new DOS runtime comparison of damage or repair timing.

## Reference fixtures and reproduction

`test/fixtures/dos_guidance.json` contains **static DOS transcriptions**, not
captured execution traces. Constants are extracted from the checksum-verified
binary; the callback samples evaluate its numerical kernel independently of
TypeScript. Ballistic samples use a separate rotation-based transcription,
adapted to the port's muzzle geometry and velocity units. Integer powers are
asserted exactly; steering components use a 1e-10 comparison tolerance.

Regenerate only when investigating reference evidence:

```bash
python3 oracle/extract_guidance_reference.py /path/to/SCORCH.EXE
```

A runtime smoke check on 2026-09-27 used DOSBox 0.74-3, surface output,
fixed 20,000 cycles, a disposable installation copy, and normal keyboard input.
The default 360×480 logical mode produces a 720×480 framebuffer. Starting cash
was set to $50,000 through Economics; guidance was bought through Purchasing,
selected through Tank Controls, and activated with Space. The
[captured target prompt](../test/fixtures/dos_guidance_target.png) confirms that
the battlefield remains visible. Pressing a tank number completed selection
and launched the shot. This session did **not** record a complete numerical
trajectory comparison. Installed files and guest code/memory were not modified.

## Browser interaction and deliberate UI improvements

`src/targeting.ts` holds a host-owned firing request with shooter, weapon,
guidance, angle and power snapshots. Equipping guidance leaves aim controls
available. Fire opens a fresh request; confirmation spends stock and clears
the selection. Cancel spends nothing. Synchronous mode first records the choice
and spends stock when the volley launches.

The local prompt is a single transparent row in the top bar, beside the player
name, with a small borderless Cancel button. It has no instructions or enclosing
panel. On narrow screens it temporarily hides the weapon readout, then power
and angle if needed, and truncates the guidance name. Numbered tank labels and
the crosshair remain on the battlefield. Escape cancellation is an intentional
improvement: the DOS picker checked here waits for a valid target. The compact
row remains visible with the HUD off. The online host uses the same row, with
cancellation on the player's controller.

Online controllers show tank buttons and bounded integer X/Y fields, followed
by an explicit **Fire at target** confirmation. The host shows the draft marker.
The same request survives reconnects; turn ownership, context and sequence
validation reject inactive players, stale controls and replayed confirmation.

`test/targeting.test.ts` covers engine integration, consumption, cancellation,
mode restrictions, arrival, swept acquisition and online authority.
`test-browser/ui.mjs` covers actual local inputs and overlay transparency;
`test-browser/online.mjs` covers phone controls, validation, reconnects and
firing. Browser captures are in `test-browser/out/`.

## Comparison limits

These corrections do not establish pixel-for-pixel full-game parity. The port
retains its fixed timestep, 12-pixel muzzle geometry and rectangular tank
collision bodies; DOS uses machine-dependent steps, design-specific muzzle
offsets and framebuffer palette masks. Lazy Boy carries fractional work across
the port's fine substeps instead of rounding up its work budget every call.
Horizontal lane checks use the port's world geometry. Exact contact pixels and
elapsed flight times can therefore differ even with the recovered guidance
rules. Numerical fixtures establish the compared kernels, not every trajectory,
weapon pairing or DOS video mode.
