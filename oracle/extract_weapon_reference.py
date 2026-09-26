#!/usr/bin/env python3
"""Extract DOS 1.5 weapon constants and fixed-point curve reference vectors.

Usage: python oracle/extract_weapon_reference.py /path/to/SCORCH.EXE
Writes test/fixtures/dos_weapons.json. Does not execute or redistribute DOS code.
The curve is an independent transcription of 2dce:05df..0820; see
WEAPON_FIDELITY.md. These are static-analysis fixtures, not DOS runtime traces.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

binary = Path(sys.argv[1]).read_bytes()
checksum = hashlib.sha256(binary).hexdigest()
assert checksum == "05e4a11643ec7055b1c811531a73c5b4f5c67c463612f3e4910e557301c3179f"
data = 0x55d80


def words(offset, count):
    return list(struct.unpack_from("<" + "h" * count, binary, data + offset))


def pairs(offset, count):
    w = words(offset, count * 2)
    return [w[i:i + 2] for i in range(0, len(w), 2)]


def signed(value):
    return (value + 2**31) % 2**32 - 2**31


def arc(x, y, target, floor, top):
    # Register-pair values are signed 16.16. Long shifts are Borland
    # 1000:18c4 (left) and 1000:18e5 (arithmetic right).
    center = (x + target) // 2
    u = [center - target, top - floor]
    v = [center - x, top - y]
    offset = [x - u[0], y - u[1]]
    size, shift = 804, 10
    while size > sum(abs(n) for n in u + v):
        size //= 2
        shift -= 1
    u, v, offset = [[signed(n * 65536) for n in a] for a in (u, v, offset)]
    output = []
    for _ in range((102944 * 2**shift) // 65536 + 1):
        point = [signed(u[i] + offset[i]) // 65536 for i in range(2)]
        if not output or point != output[-1]:
            output.append(point)
        for i in range(2):
            v[i] = signed(v[i] - (u[i] // 2**shift))
            u[i] = signed(u[i] + (v[i] // 2**shift))
    return output


def collapse(column):
    # Terminal geometry of 2a1e:0107: advance falling dirt one pixel, merge
    # dirt runs, and re-scan instead of stopping at the first filled gap.
    # Shades are preserved by the port; DOS redraws from its dirt palette.
    result = column[:]
    while True:
        changed = False
        for y in range(len(result) - 1):
            if (result[y] == 80 or 88 <= result[y] <= 104) and result[y + 1] == 0:
                result[y], result[y + 1] = 0, result[y]
                changed = True
        if not changed:
            return result


items = []
for idx in (5, 22, 23, 24):
    handler, segment, value = words(0x1200 + idx * 52, 3)
    items.append(dict(idx=idx, handler=f"{segment+0x1000:04x}:{handler:04x}", value=value))
curves = [[160, 120, 100, 238, 1], [160, 120, 220, 238, 1],
          [200, 300, 200, 478, 22], [1, 20, 2, 98, 1]]
columns = [[0, 88, 89, 0, 90, 0, 0, 91, 0, 92],
           [0, 88, 0, 89, 105, 0, 90, 0, 91, 0],
           [0, 0, 80, 104], [0, 0, 0, 0], [88, 89, 90, 91]]
result = dict(
    sha256=checksum, items=items,
    directions=pairs(0xad6, 8), sides=pairs(0xaf6, 8),
    colors=[words(0x1f62 + i*6, 3) for i in range(5)],
    charge_radius=struct.unpack_from("<f", binary, data + 0xb1c)[0],
    charge_falloff=struct.unpack_from("<f", binary, data + 0xb18)[0],
    curves=[dict(input=a, points=arc(*a)) for a in curves],
    collapse=[dict(input=a, output=collapse(a)) for a in columns],
)
Path(__file__).resolve().parents[1].joinpath("test/fixtures/dos_weapons.json").write_text(
    json.dumps(result, separators=(",", ":")) + "\n")
