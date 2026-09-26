# Local DOS reference tools

These tools inspect a legally available local Scorched Earth 1.5 installation.
They do not patch its executable or guest memory. Run the game from a disposable
copy because the original writes settings and scores during normal play.

## Disassembly

Requires a C compiler and Capstone development files:

```bash
cc disasm.c -lcapstone -o /tmp/scorch-disasm
/tmp/scorch-disasm /path/to/SCORCH.EXE 3770 0009 041d
```

Run these commands from this directory. Addresses use the analysis convention
in [WEAPON_FIDELITY.md](../WEAPON_FIDELITY.md). Borland `INT 34..3b` x87 escapes
are decoded at instruction boundaries. `INT 3c` segment overrides and `INT 3d`
synchronization remain visible; this is a disassembly aid, not a full decompiler.

## Framebuffer capture and normal input

Requires DOSBox linked to SDL 1.2, its development headers, and `sdl-config`:

```bash
cc -shared -fPIC capture.c -o /tmp/scorch-capture.so $(sdl-config --cflags --libs) -ldl
mkdir -p /tmp/scorch-reference/game /tmp/scorch-reference/frames
cp -a /path/to/local/scorch/. /tmp/scorch-reference/game/
```

Create `/tmp/scorch-reference/dosbox.conf`:

```ini
[sdl]
fullscreen=false
output=surface
[cpu]
cycles=fixed 20000
[mixer]
nosound=true
[autoexec]
mount c /tmp/scorch-reference/game
c:
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
