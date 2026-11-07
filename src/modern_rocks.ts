/** Angular sandstone silhouettes and facets, sampled by the terrain raster. */
export function rockTop(u: number, variant: number): number {
  const peak = .30 + variant * .20;
  if (u < .12) return .12 + u / .12 * .48;
  if (u < peak) return .60 + (u - .12) / (peak - .12) * .40;
  if (u < .76) return 1 - (u - peak) / (.76 - peak) * (.12 + variant * .12);
  return (.88 - variant * .12) * (1 - u) / .24;
}

export function rockContains(x: number, y: number, variant = .5): boolean {
  return x >= -.5 && x < .5 && y >= 0 && y <= rockTop(x + .5, variant);
}

export function rockColor(u: number, v: number, variant: number, grain: number): [number, number, number] {
  // Sunlit upper plane, warm front face and a darker broken right face.
  const top = rockTop(u, variant);
  let light = v > top - .19 ? 39 : u > .63 + v * .12 ? -30 : 0;
  light += (grain - .5) * 13 + variant * 18;
  // Fine bedding and a short oblique fissure keep larger blocks from looking smooth.
  if (Math.abs(v - (.33 + u * .14)) < .018 || u > .42 && u < .45 && v < .45) light -= 23;
  return [162 + light, 115 + light * .85, 74 + light * .65];
}
