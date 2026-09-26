#!/usr/bin/env python3
"""Independent static transcriptions for the weapon feedback fixes.

Usage: python oracle/extract_feedback_reference.py /path/to/SCORCH.EXE
These are disassembly-derived fixtures, not recorded DOS runtime traces.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

binary = Path(sys.argv[1]).read_bytes()
sha = hashlib.sha256(binary).hexdigest()
assert sha == "05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f"


def flow(profile, wind, limit=20):
    # 36e6:01a0..04d7, with a Python list in place of the sorted DOS links.
    w, h = 320, 480 if profile == "shaft" else 240
    def surface(x):
        if profile == "well":
            return 200 if 150 <= x < 170 else 160
        if profile == "shaft":
            return 450 if x == 160 else 50
        if profile == "slope":
            return 100 + x // 4
        return 160
    start = (160, surface(160)-1)
    occupied = {start}
    points, samples, queue = [start], [start], [start]
    maximum = 1
    def empty(x, y):
        return 1 <= x < w-1 and 2 <= y < h-1 and y < surface(x) and (x, y) not in occupied
    def neighbor(x, y):
        if empty(x, y+1):
            return (x, y+1)
        left, right = empty(x-1, y), empty(x+1, y)
        if left and right:
            return (x + (1 if wind > 0 else -1), y)
        if left:
            return (x-1, y)
        if right:
            return (x+1, y)
        if empty(x, y-1):
            return (x, y-1)
    for _ in range(1000):
        if not queue or len(samples) >= limit:
            break
        parent = min(queue, key=lambda p: (-p[1], p[0]))
        child = neighbor(*parent)
        failed = False
        if child:
            occupied.add(child)
            points.append(child)
            failed = len(queue) == 100
            if not failed:
                queue.append(child)
                maximum = max(maximum, len(queue))
            if (len(points)-1) % 20 == 0:
                samples.append(child)
        if neighbor(*parent) is None:
            queue.remove(parent)
        if failed:
            break
    return dict(profile=profile, wind=wind, limit=limit, w=w, h=h, start=start,
                count=len(points), samples=samples, points=points, max_active=maximum)


def circle(radius):
    # 4c70:026f -> 01ed eight-way plotting.
    pixels = set()
    def plot(a, b):
        pixels.update((sx*x, sy*y) for x, y in [(a, b), (b, a)] for sx in [-1, 1] for sy in [-1, 1])
    x, y, error = 0, 2*radius, 0
    while x <= y:
        if x % 2 == 0:
            plot(x//2, (y+1)//2)
        error += 2*x+1
        x += 1
        if error > 0:
            error -= 2*y-1
            y -= 1
    plot(x//2, (y+1)//2)
    return pixels


shields = []
for i in range(5):
    tier, hp, radius = struct.unpack_from("<3H", binary, 0x55d80+0x617c+16*i)
    radii = [13, 16] if tier == 1 else [radius, radius-1] if tier in [4, 5] else [radius]
    pixels = set().union(*(circle(r) for r in radii))
    if tier == 1:
        pixels = {(x, y) for x, y in pixels if -5 < x < 5 and y < 0}
    shields.append(dict(item=40+i, hp=hp, radii=radii, pixels=sorted(pixels)))

# 2d4f:014e with an injected all-zero random stream, no terrain to scorch.
flame = []
for row in range(5):
    disks = [dict(x=160-2*row, y=100-2*row, r=(5-row-2*band)//2, color=199-10*band)
             for band in range(3) if 5-row > 2*band]
    flame.append(disks)

result = dict(sha256=sha, flow=[flow(p, wind) for p in ["flat", "well", "shaft", "slope"] for wind in [-1, 1]],
              shields=shields, flame_rows=flame, shield_chip=10,
              force_divisor=struct.unpack_from("<f", binary, 0x55d80+0x1cc8)[0])
Path("test/fixtures/dos_feedback.json").write_text(json.dumps(result, separators=(",", ":"))+"\n")
