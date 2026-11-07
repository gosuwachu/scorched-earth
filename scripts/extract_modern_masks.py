"""Extract deterministic collision silhouettes from the authored sprite atlas.
Reads pixels only; does not alter artwork. Runtime never relies on image loading
or browser resampling to decide collisions. Requires Pillow.
"""
import json
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
image = Image.open(root / 'public/assets/modern/props.png').convert('RGBA')
width, height = image.size
sprites = {}
for n, name in enumerate(['pine', 'tree', 'cactus', 'house', 'tower', 'car', 'animal', 'shack']):
    left, top = n % 4 * width // 4, n // 4 * height // 2
    right, bottom = (n % 4 + 1) * width // 4, (n // 4 + 1) * height // 2
    # Ignore faint antialias/shadow pixels when determining the collision bounds.
    points = [(x, y) for y in range(top, bottom) for x in range(left, right) if image.getpixel((x, y))[3] >= 128]
    x0, y0 = min(x for x,y in points), min(y for x,y in points)
    x1, y1 = max(x for x,y in points)+1, max(y for x,y in points)+1
    rows = [''.join('1' if image.getpixel((min(x1-1, int(x0+(x+.5)*(x1-x0)/128)), min(y1-1, int(y0+(y+.5)*(y1-y0)/128))))[3] >= 128 else '0' for x in range(128)) for y in range(128)]
    sprites[name] = {'bounds': [x0,y0,x1-x0,y1-y0], 'rows': rows}
(root / 'src/modern_masks.json').write_text(json.dumps(sprites, separators=(',', ':'))+'\n')
print(f'Extracted {len(sprites)} collision silhouettes from {width}x{height} atlas')
