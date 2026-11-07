# Modern artwork

Original generated artwork made for this experiment with the built-in imagegen
skill/tool. These are game assets, not DOS captures or fidelity references.

- `alpine.png`, `desert.png`, `swamp.png`, `cave.png`, `city.png`: distant,
  non-collidable environment paintings. Foreground geometry is generated separately.
- `earth.png`: mineral/soil texture; the renderer tints it by material and biome.
- `props.png`: transparent sprite atlas. Rows contain pine/willow/cactus/cottage
  and tower/car/deer/shack. The first seven sprites are used in this version.
- `provenance.json`: generation specifications.

`python scripts/extract_modern_masks.py` reads alpha from the atlas and writes
`src/modern_masks.json`. It requires Pillow. This is an asset compilation step,
not a regression fixture generator. It records crop bounds and 128×128 binary
silhouettes. Both rendering and generation use those exact samples, so image
load timing and browser image resampling cannot affect collision or saves.
