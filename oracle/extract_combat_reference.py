#!/usr/bin/env python3
"""Static DOS fixtures, independently transcribed from the handlers.

No TypeScript or historical Python game code is imported. This is not a DOS
runtime trace. Usage: python oracle/extract_combat_reference.py SCORCH.EXE
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

binary = Path(sys.argv[1]).read_bytes()
sha = hashlib.sha256(binary).hexdigest()
assert sha == "05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f"
ds = 0x55d80


def texture(w, h):
    # A supplied deterministic random stream, independent of either game's RNG.
    seed = 123456789

    def pick(n):
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) % 2**32
        return seed % n if n else 0

    grid = [[0 for _ in range(w)] for _ in range(h)]
    for x, y in [(0, 0), (w-1, 0), (w-1, h-1), (0, h-1)]:
        grid[y][x] = pick(40)

    def edge(a, b):
        x, y = (a[0]+b[0])//2, (a[1]+b[1])//2
        if grid[y][x]:
            return
        distance = abs(a[0]-b[0]) + abs(a[1]-b[1])
        value = (grid[a[1]][a[0]] + grid[b[1]][b[0]] + 1)//2
        grid[y][x] = min(39, max(0, value + pick(distance*2) - distance))

    def subdivide(a, b):
        x0, y0 = a
        x1, y1 = b
        if x1-x0 < 2 and y1-y0 < 2:
            return
        x, y = (x0+x1)//2, (y0+y1)//2
        for p, q in [(a, (x1, y0)), ((x1, y0), b), (b, (x0, y1)), ((x0, y1), a)]:
            edge(p, q)
        grid[y][x] = (grid[y0][x0]+grid[y0][x1]+grid[y1][x1]+grid[y1][x0]+2)//4
        for p, q in [(a, (x, y)), ((x, y0), (x1, y)), ((x, y), b), ((x0, y), (x, y1))]:
            subdivide(p, q)

    subdivide((0, 0), (w-1, h-1))
    return [n for row in grid for n in row]


items = []
for idx in range(33):
    ip, seg, value = struct.unpack_from("<HHh", binary, ds + 0x1200 + idx*52)
    items.append(dict(idx=idx, handler=f"{seg+0x1000:04x}:{ip:04x}", value=value))
result = dict(sha256=sha, items=items,
    mirv=list(struct.unpack_from("<6h", binary, ds+0x529e)),
    leap_radii=list(struct.unpack_from("<3h", binary, ds+0x50ca)),
    leap_divisor=struct.unpack_from("<f", binary, ds+0x50d0)[0],
    texture=[dict(w=w, h=h, pixels=texture(w, h)) for w, h in [(3, 3), (9, 7), (13, 13)]],
    plasma=[dict(scale=scale, radii=[round(20*scale) + int((round(75*scale)-round(20*scale))*n/10)
        for n in range(11)]) for scale in [0.5, 0.75, 1, 2, 3]],
    damage=[dict(idx=idx, r=r, distance=d, amount=(lambda n: 110 if n > 100 else n)(round((r-d)*100/r)*(idx+1)))
        for idx, r in [(0, 10), (1, 20), (2, 40), (3, 75), (7, 35)] for d in [0, r//2, r-1]],
)
Path(__file__).resolve().parents[1].joinpath("test/fixtures/dos_combat.json").write_text(json.dumps(result, separators=(",", ":"))+"\n")
