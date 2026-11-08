"""Compile the retained generated desert atlases; preserve sprite alpha."""
from PIL import Image
from pathlib import Path

archive = Path("artwork/desert-v1")
out = Path("public/assets/modern/terrain-v3")
out.mkdir(parents=True, exist_ok=True)
im=Image.open(archive/'strata.png')
for name,box in [('desert-sand',(0,0,1672,230)),('desert-cliff',(0,235,1672,469)),('desert-beds',(0,480,1672,697)),('desert-deep',(0,710,1672,941))]:
 im.crop(box).save(out/(name+'.webp'),quality=93)
im=Image.open(archive/'scenery.png')
out=Path('public/assets/modern/desert-v1'); out.mkdir(exist_ok=True)
for name,box in [('shrub',(0,0,768,512)),('rock',(768,0,1536,512)),('adobe',(0,512,768,1024)),('truck',(768,512,1536,1024))]:
 part=im.crop(box); bounds=part.getchannel('A').point(lambda x:255 if x>32 else 0).getbbox(); part=part.crop(bounds); part.save(out/(name+'.png'))
 print(name,part.size)

# The bottom layer now uses one full-frame painting rather than an atlas strip.
Image.open("artwork/desert-v2/bedrock.png").save(
    "public/assets/modern/terrain-v3/desert-deep-v2.webp", quality=93)

# Current full-frame materials. Preserve native dimensions; never crop strips
# or upscale the generated paintings to manufacture additional resolution.
for name in ("sand", "cliff", "beds", "deep"):
    source = Image.open(Path("artwork/desert-v3") / (name + ".png"))
    source.save(
        Path("public/assets/modern/terrain-v3") / ("desert-" + name + "-v3.webp"),
        quality=93,
    )
