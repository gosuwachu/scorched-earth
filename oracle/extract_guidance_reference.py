#!/usr/bin/env python3
"""Independent static DOS 1.5 guidance reference (not DOS execution traces).
Constants: DS:5186, 31fc, 321c, 3224, 3228. Kernels: 2e50:0001/05e9/099c/0c30.
Only numerical fixtures are distributed; the executable is read, never modified.
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
def scalar(offset, fmt):
    return struct.unpack_from("<" + fmt, binary, 0x55d80 + offset)[0]
constants = dict(heat_range=scalar(0x5186, "h"), lazy_speed=scalar(0x31fc, "f"),
                 min_distance_squared=scalar(0x321c, "d"), heat_vertical_accel=scalar(0x3224, "f"),
                 horizontal_accel=scalar(0x3228, "f"))
steering = []
for slot in (33, 35, 36):
    for dx, dy, vx, vy in ((100, 0, 70, -8), (-36, 48, -40, 60), (0, 81, 10, -70), (20, -10, 30, 20)):
        k = constants['horizontal_accel' if slot == 35 else 'heat_vertical_accel']
        f = k / 1920 / ((dx*dx + dy*dy) ** 0.25)
        steering.append(dict(slot=slot, delta=[dx, dy], velocity=[vx, vy], result=[vx+dx*f, vy-dy*f]))
# Independently transcribe DOS's rotated-gravity calculation, in the port's
# existing muzzle geometry and units. This does not import TS or the Python port.
ballistic = []
for angle in (35, 55, 135):
    for wind in (-100, 0, 100):
        rad = angle * scalar(0x320c, 'd')
        x = (100 if angle > 90 else 800) - (400 + 12*math.cos(rad))
        y = 500 - 4 - 12*math.sin(rad) - 450
        wx = wind / scalar(0x3208, 'f')
        if x < 0:
            x = -x
            wx = -wx
        a = (180-angle if angle > 90 else angle) * scalar(0x320c, 'd')
        theta = math.atan(wx / 0.2)
        distance = math.hypot(x,y)
        direction = math.atan(y/x) - theta
        xr, yr = distance * math.cos(direction), distance * math.sin(direction)
        ar = a-theta
        square = math.hypot(0.2, wx)*xr*xr/(2*math.cos(ar)**2*(xr*math.tan(ar)-yr))
        ballistic.append(dict(angle=angle, wind=wind, target=[100 if angle>90 else 800,450],
                              power=min(1000,round(math.sqrt(abs(square))*scalar(0x3218,'f')))))
result = dict(sha256=sha, constants=constants, steering=steering, ballistic=ballistic)
Path(__file__).resolve().parents[1].joinpath('test/fixtures/dos_guidance.json').write_text(json.dumps(result, indent=2)+'\n')
