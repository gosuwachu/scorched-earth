# Local DOS reference tools

These tools inspect a legally available local Scorched Earth 1.5 installation.
They do not patch its executable or guest memory. Run the game from a disposable
copy because the original writes settings and scores during normal play.
All commands below run from the repository root.

## Start with retained evidence

Read [COMBAT_FIDELITY.md](../COMBAT_FIDELITY.md),
[WEAPON_FIDELITY.md](../WEAPON_FIDELITY.md), and the relevant
`test/fixtures/dos_*.json` before starting a new reference session. Ordinary
regressions use those fixtures without DOSBox. Run a fresh capture or calibration
when investigating missing evidence, a mismatch, or a different machine profile.
Small calibration variation between boots is expected; do not retune the browser
constant after every measurement.

The original DOS executable is the sole fidelity reference. Use its runtime
captures and directly checked binary/disassembly evidence for new comparisons.
Do not generate reference behavior or images by running the Python game port.
Python capture/extraction scripts that read the original executable are still
part of this workflow.

The calibrated profile is DOSBox 0.74-3 linked to SDL 1.2, normal CPU core,
fixed 20,000 cycles, SVGA S3, surface output, and logical resolution 360×480.
Check the executable checksum and record any profile changes before comparing
new results. This mode's 720×480 framebuffer doubles horizontal pixels; compare
simulation coordinates in logical pixels.

## Disassembly

Requires a C compiler and Capstone development files:

```bash
cc oracle/dos/disasm.c -lcapstone -o /tmp/scorch-disasm
/tmp/scorch-disasm /path/to/SCORCH.EXE 3770 0009 041d
```

Addresses use the analysis convention
in [WEAPON_FIDELITY.md](../WEAPON_FIDELITY.md). Borland `INT 34..3b` x87 escapes
are decoded at instruction boundaries. `INT 3c` segment overrides and `INT 3d`
synchronization remain visible; this is a disassembly aid, not a full decompiler.

## Framebuffer capture and normal input

Requires DOSBox linked to SDL 1.2, its development headers, and `sdl-config`:

```bash
cc -shared -fPIC oracle/dos/capture.c -o /tmp/scorch-capture.so $(sdl-config --cflags --libs) -ldl
mkdir -p /tmp/scorch-reference/game /tmp/scorch-reference/frames
cp -a /path/to/local/scorch/. /tmp/scorch-reference/game/
```

Create `/tmp/scorch-reference/dosbox.conf`:

```ini
[sdl]
fullscreen=false
output=surface
[dosbox]
machine=svga_s3
[cpu]
core=normal
cycles=fixed 20000
[mixer]
nosound=true
[autoexec]
mount c /tmp/scorch-reference/game
c:
set ASGARD=ragnarok
scorch
exit
```

Launch just this reference process with the adapter:

```bash
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
SCORCH_CAPTURE=/tmp/scorch-reference/frames LD_PRELOAD=/tmp/scorch-capture.so \
dosbox -conf /tmp/scorch-reference/dosbox.conf
```

`frames/latest.bmp` updates atomically. Creating `frames/record` also saves
numbered frames every 16 ms; remove that file when the short capture ends.
Recording continuously produces large uncompressed files.

Write a command to `frames/input` with a fresh integer ID each time:

```text
1 k 13
2 k 105
3 m 360 267
4 q
```

These mean Enter, I (inventory), a mouse click at (360,267), and quit the isolated
DOSBox process. Key numbers are SDL 1.2 key symbols. Inspect `latest.bmp` between
commands: menus require time to advance and are state-dependent. To export a
lossless reference PNG:

```bash
ffmpeg -i /tmp/scorch-reference/frames/latest.bmp reference.png
```

ImageMagick also works: `magick /tmp/scorch-reference/frames/latest.bmp reference.png`.

Gameplay polls held keys. Use `5 k 32 100` to hold Space for 100 ms, or set
`SCORCH_KEY_HOLD_MS=100` for a process-wide default. The optional fourth field
overrides that default for a key command. Menu navigation generally works with
the default instantaneous release; a long hold can repeat menu actions.

## Avoid common capture failures

- Use a fresh capture directory for each process. `memory.jsonl` appends, and an
  old `input` file can replay a command (including quit) immediately on startup.
  Never let two DOSBox processes share a capture/input directory.
- The input file holds **one command**, not a queue. Replace it with a new ID for
  each action, ideally by writing a temporary file then renaming it. Wait for the
  expected screen or state before replacing it again. The calibration helper's
  tested startup waits three seconds for the title and one second between keys.
- Outside that known startup sequence, inspect `latest.bmp` or memory samples
  between actions. Space during an existing flight can be ignored; wait for the
  next aiming screen before firing again. Round-end and shopping screens also
  interrupt blind key sequences. Record a shot from before launch, then verify
  which tank and shield were actually active before naming its fixture.
- Prefer menu hotkeys to coordinate clicks for repeatable setup. Held arrow or
  Page Up/Down keys can repeat quickly: check the resulting angle and power
  instead of assuming a fixed increment. Use short menu presses and an explicit
  hold for gameplay input such as `k 32 100`.
- Use a DOS-generated `SCORCH.CFG` or the calibration helper's known settings.
  Original keys include `MAXPLAYERS` and `ARMS`, not `PLAYERS` and `ARMS_LEVEL`.
  `PLAY_MODE=Sequential` and `PLAY_ORDER=Round-Robin` are different settings;
  `Sequential` is not a valid play-order value. Confirm settings on screen or in
  samples rather than assuming a configuration was accepted. Saving from the
  DOS menu may replace lowercase `scorch.cfg` with uppercase `SCORCH.CFG`.
- Create `record` only around the short interval whose frames are needed, then
  remove it. Keep the compact numeric samples and provenance for regression
  tests; continuous BMP capture grows quickly.

## Magnetic timing reference

`magnet.c` samples emulator memory without changing guest memory or code. It
locates the relocated DOS data segment by a string signature and validates the
Mag definition and its far pointer. It requires Linux `/proc/self/maps`, an
x86 little-endian host, and the exact Scorched Earth 1.5 executable with SHA-256
`05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f`.

To reproduce the five-boot calibration in a **new** disposable directory:

```bash
python3 oracle/dos/calibrate_magnet.py /path/to/SCORCH.EXE /tmp/mag-calibration
```

The helper compiles both adapters, copies the executable and mountain assets,
starts DOSBox at fixed 20,000 cycles with its normal CPU core, enters two human
players, and fires the first Baby Missile through normal keyboard input. Each
run retains the shared config plus each boot's console output, framebuffer and
`memory.jsonl` samples;
`calibration.json` reports the median. It never edits the installed game or
automatically changes the browser's frozen reference value. BIOS-clock
quantization causes small differences between fresh boots.

For interactive captures, preload `magnet.so` **before** `capture.so` and use
the input commands above. Samples contain the runtime calibration (`DS:1c86`),
live projectile count (`1c78`), Fire Delay (`5140`), DOS timestep (`ceac`), screen
bounds, tank positions/shield strength, and projectile `[x,y,vx,vy]` values from
the array at `ceb8`, stride `0x6c`. Sampling occurs at SDL event polls, at least
16 ms apart; wall-clock timestamps are not simulation time. With zero wind and
drag and constant horizontal velocity, elapsed simulation time is `(x-x0)/vx`.
Only compare continuous flight windows before contact/clamping and without
changes in N. The sampler reads the first N slots; it does not track projectile
identities through removal/compaction. Timing/count measurements remain useful
across those events, but the slot positions are not used as trajectory evidence.

The retained observations in `test/fixtures/dos_magnet.json` include five fresh
boots, three flight windows (Mag, Super Mag and no shield), and the count/timestep
sequence of a real MIRV split and subsequent child removals. For the flight
captures, enable $1,000,000 starting cash and Round-Robin order, buy both shield
types for the target, and engage them with Tank Controls (`t`, `s`, `e`). The
recorded Baby Missile launch uses power 1000, angle 85, from tank (91,441) toward
(268,363). These positions are observations from that terrain, not a seed which
reproduces the DOS RNG. Samples end before terrain contact. The fixture contains
the observed samples, not trajectories synthesized by the browser or Python port.
