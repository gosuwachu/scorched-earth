#!/usr/bin/env python3
"""Measure five fresh DOS boots without modifying the reference executable.

Usage: python oracle/dos/calibrate_magnet.py /path/to/SCORCH.EXE /tmp/mag-reference
Requires Linux, DOSBox 0.74-3 (SDL 1.2), cc and sdl-config. Writes only under the
new output directory. Prints measurements; never changes browser constants.
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import statistics
import subprocess
import sys
import time

exe = Path(sys.argv[1]).resolve()
assert hashlib.sha256(exe.read_bytes()).hexdigest() == "05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f"
root = Path(sys.argv[2]).resolve()
root.mkdir()  # Refuse to reuse captures from an earlier run.
game = root / "game"
game.mkdir()
shutil.copyfile(exe, game / "SCORCH.EXE")
for source in exe.parent.iterdir():
    if source.suffix.upper() == ".MTN":
        shutil.copyfile(source, game / source.name)
(game / "SCORCH.CFG").write_text("""MAXPLAYERS=2
MAXROUNDS=10
SOUND=Off
FLY_SOUND=Off
GRAPHICS_MODE=360x480
BIOS_KEYBOARD=On
FIRE_DELAY=100
INITIAL_CASH=0
AIR_VISCOSITY=0
GRAVITY=0.200000
FALLING_TANKS=Off
SKY=Plain
MAX_WIND=0
CHANGING_WIND=Off
LAND1=20
LAND2=20
FLATLAND=On
RANDOM_LAND=Off
MTN_PERCENT=0.000000
TALKING_TANKS=Off
PLAY_MODE=Sequential
PLAY_ORDER=Random
ARMS=4
TRACE=On
""")
config = root / "dosbox.conf"
config.write_text(f"""[sdl]
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
mount c "{game}"
c:
set ASGARD=ragnarok
scorch
exit
""")
flags = shlex.split(subprocess.check_output(["sdl-config", "--cflags", "--libs"], text=True))
for name in ["magnet", "capture"]:
    subprocess.run(["cc", "-shared", "-fPIC", "-Wall", "-Wextra", str(Path(__file__).with_name(f"{name}.c")),
                    "-o", str(root / f"{name}.so"), *flags, "-ldl"], check=True)
measurements = []
for boot in range(1, 6):
    frames = root / f"boot-{boot}"
    frames.mkdir()
    env = os.environ | dict(SDL_VIDEODRIVER="dummy", SDL_AUDIODRIVER="dummy",
        SCORCH_KEY_HOLD_MS="100", SCORCH_CAPTURE=str(frames),
        LD_PRELOAD=f"{root}/magnet.so:{root}/capture.so")
    with (frames / "console.txt").open("w") as log:
        process = subprocess.Popen(["dosbox", "-conf", str(config)], env=env, stdout=log, stderr=log)
        try:
            time.sleep(3)  # Let the title screen finish before Start.
            for command, key in enumerate([115, 97, 13, 100, 98, 13, 100, 32], 1):
                (frames / "input").write_text(f"{command} k {key}\n")
                time.sleep(1)
            time.sleep(1)
            (frames / "input").write_text("99 q\n")
            process.wait(timeout=5)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    rows = [json.loads(line) for line in (frames / "memory.jsonl").read_text().splitlines()]
    measured = next(r for r in rows if r["calibration"] and r["n"] == 1)
    measurements.append({k: measured[k] for k in ["calibration", "n", "delay", "dt"]})
    print(f"Boot {boot}: {measurements[-1]}", flush=True)
result = dict(calibrations=measurements, referenceCalibration=statistics.median(r["calibration"] for r in measurements))
(root / "calibration.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
