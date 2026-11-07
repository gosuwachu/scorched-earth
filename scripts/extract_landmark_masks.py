"""Compile generated landmark alpha into deterministic collision silhouettes.
Reads original PNGs only; does not edit artwork or generate test expectations.
"""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
masks = {}
for name in ['bloomberg', 'st_pauls']:
    image = Image.open(root / 'public/assets/modern' / f'{name}.png').convert('RGBA')
    alpha = image.getchannel('A')
    solid = alpha.point(lambda a: 255 if a >= 128 else 0)
    x0, y0, x1, y1 = solid.getbbox()
    size = 256
    rows = [''.join('1' if alpha.getpixel((
        min(x1 - 1, int(x0 + (x + .5) * (x1 - x0) / size)),
        min(y1 - 1, int(y0 + (y + .5) * (y1 - y0) / size)),
    )) >= 128 else '0' for x in range(size)) for y in range(size)]
    masks[name] = {'bounds': [x0, y0, x1 - x0, y1 - y0], 'rows': rows}
(root / 'src/landmark_masks.json').write_text(json.dumps(masks, separators=(',', ':')) + '\n')
print('Compiled two 256 x 256 landmark silhouettes from PNG alpha')
