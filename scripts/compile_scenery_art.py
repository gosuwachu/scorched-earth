"""Compile generated PNG originals into lossless runtime textures and masks.
No artistic edits: WebP decoding is checked against the original RGBA pixels.
Masks retain the main connected structure, excluding detached alpha speckles.
"""
import base64
import json
from collections import deque
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
import sys
collection = sys.argv[1] if len(sys.argv) > 1 else 'buildings'
if collection not in ['buildings', 'props']: raise SystemExit('Expected buildings or props')
source = root / f'artwork/{collection}-v2'
output = root / f'public/assets/modern/{collection}-v2'
output.mkdir(parents=True, exist_ok=True)
names = ['house', 'tower', 'office', 'apartment', 'shop', 'warehouse', 'st_pauls',
         'big_ben', 'london_eye', 'bloomberg', 'gherkin', 'bridge', 'golden_gate',
         'lighthouse', 'detached', 'semi', 'townhouse']
if collection == 'props': names = ['pine', 'tree', 'cactus']
result = {}
for name in names:
    path = source / f'{name}.png'
    if not path.exists():
        raise SystemExit(f'Missing generated sprite: {path}')
    image = Image.open(path).convert('RGBA')
    image.save(output / f'{name}.webp', lossless=True, exact=True, method=6)
    assert Image.open(output / f'{name}.webp').convert('RGBA').tobytes() == image.tobytes()
    alpha = image.getchannel('A')
    box = alpha.point(lambda a: 255 if a >= 128 else 0).getbbox()
    if box is None: raise ValueError(f'Empty sprite: {name}')
    x0, y0, x1, y1 = box
    size = 256
    grid = bytearray(alpha.getpixel((
        min(x1 - 1, int(x0 + (x + .5) * (x1 - x0) / size)),
        min(y1 - 1, int(y0 + (y + .5) * (y1 - y0) / size)),
    )) >= 128 for y in range(size) for x in range(size))
    seen, largest = bytearray(len(grid)), []
    for start, value in enumerate(grid):
        if not value or seen[start]: continue
        queue, component = deque([start]), []
        seen[start] = 1
        while queue:
            i = queue.popleft(); component.append(i)
            x, y = i % size, i // size
            for nx, ny in [(x-1,y), (x+1,y), (x,y-1), (x,y+1)]:
                if 0 <= nx < size and 0 <= ny < size:
                    n = ny * size + nx
                    if grid[n] and not seen[n]: seen[n] = 1; queue.append(n)
        if len(component) > len(largest): largest = component
    retained = len(largest) / max(1, sum(grid))
    if retained < .95: raise ValueError(f'{name}: disconnected illustration ({retained:.1%} retained)')
    packed = bytearray(size * size // 8)
    for i in largest: packed[i >> 3] |= 1 << (i & 7)
    record = {'bounds': [x0, y0, x1-x0, y1-y0], 'size': size,
              'bits': base64.b64encode(packed).decode()}
    if name in ['bridge', 'golden_gate']:
        # Deck is the highest broad horizontal member below the bridge towers.
        rows = [(sum(grid[y*size+size//10:y*size+size*9//10]), y) for y in range(size)]
        candidates = [y for coverage,y in rows if coverage >= size * .7]
        if not candidates: raise ValueError(f'{name}: no continuous deck')
        record['deck'] = 1 - min(candidates) / size
    result[name] = record
    print(f'{name}: alpha support {retained:.1%}, {x1-x0}x{y1-y0}')
(root / ('src/building_masks.json' if collection == 'buildings' else 'src/plant_masks.json')).write_text(json.dumps(result, separators=(',', ':')) + '\n')
