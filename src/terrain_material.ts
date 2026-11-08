/** Painted material sampling with overlapping edges, so even non-periodic
 * source paintings repeat without a hard seam. Coordinates stay world anchored. */
export type MaterialPixels = { width: number; height: number; data: Uint8ClampedArray };

/** A complete painting mapped once across the world. No seed offsets or
 * wrapping: fractures retain their position through excavation and reloads. */
export function fullFrameMaterial(image: MaterialPixels, x: number, y: number,
  width: number, height: number): [number, number, number] {
  const sx = Math.max(0, Math.min(image.width - 1, Math.floor(x * image.width / width)));
  const sy = Math.max(0, Math.min(image.height - 1, Math.floor(y * image.height / height)));
  const i = (sy * image.width + sx) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

export function paintedMaterial(image: MaterialPixels, x: number, y: number, seed: number): [number, number, number] {
  const overlap = Math.min(128, Math.floor(Math.min(image.width, image.height) / 8));
  const pw = image.width - overlap, ph = image.height - overlap;
  const sx = ((Math.floor(x + seed * 37) % pw) + pw) % pw;
  const sy = ((Math.floor(y + seed * 19) % ph) + ph) % ph;
  const bx = sx < overlap ? 1 - sx / overlap : 0;
  const by = sy < overlap ? 1 - sy / overlap : 0;
  const offset = (sy * image.width + sx) * 4;
  const right = bx ? offset + pw * 4 : offset;
  const below = by ? ph * image.width * 4 : 0;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = image.data[offset + k] * (1 - bx) + image.data[right + k] * bx;
    const b = image.data[offset + below + k] * (1 - bx) + image.data[right + below + k] * bx;
    rgb[k] = a * (1 - by) + b * by;
  }
  return rgb;
}
