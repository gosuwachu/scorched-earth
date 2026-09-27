#!/usr/bin/env python3
"""Checksum-pinned DOS 1.5 static transcriptions, NOT runtime recordings.

Usage: python3 oracle/extract_tunneling_reference.py /path/to/SCORCH.EXE
Only reads the executable; never runs the retired Python game implementation.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

binary = Path(sys.argv[1]).read_bytes()
sha = hashlib.sha256(binary).hexdigest()
assert sha == "05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f"
retention, threshold = struct.unpack_from("<ff", binary, 0x55d80 + 0x1d54)

# 2a4a:0a1e..0a84 compares handler pointers, not weapon names.
eligibility = []
for item in range(33):
    offset, segment = struct.unpack_from("<HH", binary, 0x55d80 + 0x1200 + item * 52)
    mode = 0 if (segment, offset) in [(0x2fbd, 3), (0x3d1e, 2), (0x15a0, 0x81)] else -1
    eligibility.append(dict(item=item, mode=mode))


def walk(x0, y0, x1, y1):
    # 271b:0733..081a, including both endpoints and the >=0 diagonal tie.
    dx, dy = abs(x1-x0), abs(y1-y0)
    sx, sy = (-1 if x1 < x0 else 1), (-1 if y1 < y0 else 1)
    major, minor = max(dx, dy), min(dx, dy)
    straight = (sx, 0) if dx >= dy else (0, sy)
    error = 2 * minor - major
    pixels = []
    for _ in range(major + 1):
        pixels.append([x0, y0])
        if error < 0:
            x0 += straight[0]
            y0 += straight[1]
            error += 2 * minor
        else:
            x0 += sx
            y0 += sy
            error += 2 * (minor-major)
    return pixels


def penetrate(vx, vy, pixels):
    # 2a4a:169a..1714. Threshold test precedes clearing this pixel.
    cleared = 0
    velocities = []
    for _ in range(pixels):
        vx *= retention
        vy *= retention
        velocities.append([vx, vy])
        if vx*vx + vy*vy < threshold:
            return dict(velocity=[vx, vy], velocities=velocities, cleared=cleared, detonated=True)
        cleared += 1
    return dict(velocity=[vx, vy], velocities=velocities, cleared=cleared, detonated=False)


cases = []
for vx, vy, pixels in [(1000, 0, 20), (600, -800, 20), (-600, 800, 3), (0, -100, 8),
                        (80, 0, 1), (0, 0, 1), (60, 0, 1), (59, 0, 1),
                        (80/3, 160/3, 1), (80/3, (160-0.001)/3, 1),
                        (80/3, (160+0.001)/3, 1)]:
    cases.append(dict(incoming=[vx, vy], pixels=pixels, **penetrate(vx, vy, pixels)))
rasters = [dict(start=[20, 20], end=[20+x, 20+y], pixels=walk(20, 20, 20+x, 20+y))
           for x in range(-5, 6) for y in range(-5, 6)]
out = Path(__file__).resolve().parents[1] / "test/fixtures/dos_tunneling.json"
out.write_text(json.dumps(dict(sha256=sha, kind="static DOS transcription; not execution samples",
    retention=retention, speedSquaredThreshold=threshold, eligibility=eligibility,
    penetration=cases, rasters=rasters), indent=2) + "\n")
print(out)
