#!/usr/bin/env python3
"""DOS 1.5 shield constants and independent static-transcription fixtures.

Usage: python oracle/extract_shield_reference.py /path/to/SCORCH.EXE
These are NOT DOS execution recordings. Flight samples use the browser's
1/1920 timestep with DOS's magnetic increment and callback ordering.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

binary = Path(sys.argv[1]).read_bytes()
sha = hashlib.sha256(binary).hexdigest()
assert sha == "05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f"


def data(fmt, offset):
    return struct.unpack_from("<" + fmt, binary, 0x55d80 + offset)[0]


push = data("f", 0x1cf2)
retention = data("d", 0x1d60)
speed_divisor = data("f", 0x1cc8)
shields = []
for i in range(5):
    tier, hp, radius, r, g, b, flags, _ = struct.unpack_from("<8H", binary, 0x55d80 + 0x617c + 16*i)
    shields.append(dict(item=40+i, tier=tier, hp=hp, radius=radius,
                        push=bool(flags & 6), deflect=bool(flags & 1), laserproof=tier == 5))


def magnetic(dx, dy, vx, delay=100, hp=55, alive=True, owner=False, height=240):
    # 2a4a:28b4..2a0d; banker's rounding is FUN_1000_14df.
    eligible = alive and hp > 0 and not owner and vx != 0
    eligible = eligible and abs(round(dx)) <= 15 and 0 < round(dy) <= (height-1)//4
    return (push / delay if delay else push) if eligible else 0


magnetic_steps = []
for dx, dy in [(-16, 40), (-15.5, 40), (-15, 40), (0, 40), (15, 40), (15.5, 40),
               (16, 40), (0, 0), (0, 0.5), (0, 1), (0, 59), (0, 59.5), (0, 60), (0, -1)]:
    for vx in [0, 10]:
        magnetic_steps.append(dict(dx=dx, dy=dy, vx=vx, delay=100, hp=55, alive=True,
                                   owner=False, bump=magnetic(dx, dy, vx)))
for overrides in [dict(delay=0), dict(delay=50), dict(delay=200), dict(hp=0), dict(alive=False), dict(owner=True)]:
    args = dict(dx=0, dy=40, vx=10, delay=100, hp=55, alive=True, owner=False) | overrides
    magnetic_steps.append(args | dict(bump=magnetic(**args)))


def flight(name, dx, dy, vx, vy, steps, delay=100):
    args = dict(name=name, dx=dx, dy=dy, vx=vx, vy=vy, steps=steps, delay=delay)
    x, y, dt = 160 + dx, 159 - dy, 1 / 1920
    samples = []
    for tick in range(steps + 1):
        if tick % 32 == 0:
            samples.append(dict(tick=tick, x=x, y=y, sx=round(x), sy=round(y), vx=vx, vy=vy))
        if tick == steps:
            break
        speed = math.hypot(vx, vy)
        if speed > 1000:
            vx, vy = vx * 1000 / speed, vy * 1000 / speed
        # 2a4a:0b1f: move, gravity, collision (none in these samples), then
        # 120b..123c: registered magnetic callbacks, then weapon predicate.
        x += vx * dt
        y -= vy * dt
        vy -= 2500 * 0.2 * dt
        vy += magnetic(x - 160, 159 - y, vx, delay)
    return args | dict(samples=samples)


flights = [flight("slow descent turns upward", -10, 40, 10, -100, 640),
           flight("fast descent still approaches the shield", -10, 40, 10, -400, 96),
           flight("outside field", 16, 60, 20, -50, 640),
           flight("exactly vertical bypass", 0, 40, 0, -100, 128),
           flight("zero fire delay", -10, 40, 10, -100, 64, 0)]


def force(name, nx, ny, vx, vy, hp=100):
    # 2a4a:25cf..26b5's doubled-angle rotation, independently transcribed.
    # Both velocity and normal have Y positive UP. The browser uses the
    # equivalent vector projection to preserve exact axial zero components.
    sign = lambda n: (n > 0) - (n < 0)
    outgoing = sign(nx) == sign(vx) and sign(ny) == sign(vy)
    cost = 0 if outgoing else round(math.hypot(vx, vy) / speed_divisor)
    angle = (math.atan2(vy, vx) - math.atan2(ny, nx)) * data("f", 0x1d5c)
    cosine, sine = math.cos(angle), math.sin(angle)
    result = [vx, vy] if outgoing else [(-cosine*vx-sine*vy)*retention, (sine*vx-cosine*vy)*retention]
    return dict(name=name, normal=[nx, ny], incoming=[vx, vy], hp=hp, outgoing=outgoing,
                velocity=result, cost=cost, shield_hp=max(0, hp-cost), health=100-max(0, cost-hp))


reflections = [force("top", 0, 15, 0, -300), force("left", -15, 0, 300, 0),
               force("right", 15, 0, -300, 0), force("oblique left", -9, 12, 240, -180),
               force("oblique right", 9, 12, -240, -180), force("outgoing", 9, 12, 80, 100),
               force("exhausted", 0, 15, 0, -300, 2), force("rounding tie", 0, 15, 0, -250),
               force("very slow", 0, 15, 0, -10)]

out = Path(__file__).resolve().parents[1] / "test/fixtures/dos_shields.json"
out.write_text(json.dumps(dict(sha256=sha, kind="static transcription; browser timestep", shields=shields,
                               magnetic_steps=magnetic_steps, flights=flights, reflections=reflections), indent=2) + "\n")
print(out)
