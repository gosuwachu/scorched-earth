/** Browser-only park scenery. Shapes also define the destructible collision mask. */
export const PARK_PROPS = ["lawn", "swings", "playground", "stadium"] as const;
export type ParkProp = typeof PARK_PROPS[number];
export function isParkProp(kind: string): kind is ParkProp {
  return (PARK_PROPS as readonly string[]).includes(kind);
}
export function parkContains(kind: ParkProp, x: number, y: number): boolean {
  if (x < -.5 || x >= .5 || y <= 0 || y > 1) return false;
  const ax = Math.abs(x);
  switch (kind) {
    case "lawn": return true;
    case "swings": return y > .9 || Math.abs(ax - (.45 - y * .12)) < .06 ||
      y > .28 && (Math.abs(ax - .13) < .04 || Math.abs(ax - .26) < .04) ||
      y > .25 && y < .31 && ax > .1 && ax < .29;
    case "playground": return x < -.08 && x > -.44 && y > .74 && y < 1 - Math.abs(x + .26) * .6 ||
      (Math.abs(x + .38) < .03 || Math.abs(x + .14) < .03) && y < .78 ||
      x > -.42 && x < -.1 && y > .5 && y < .58 ||
      x > -.1 && Math.abs(y - (.54 - (x + .1) * .95)) < .045 ||
      x > -.38 && x < -.14 && y < .5 && Math.abs(y * 8 - Math.round(y * 8)) < .1;
    case "stadium": return y < .22 || ax > .32 && y < .65 ||
      ax > .44 && y < .9 || ax > .37 && y > .88 ||
      y > .20 && y < .47 && (Math.abs(ax - .24) < .024 || y > .44 && ax > .13 && ax < .25);
  }
}
export function parkColor(kind: ParkProp, u: number, v: number, grain: number): [number, number, number] {
  const light = grain * 16 + (1 - u) * 10;
  if (kind === "lawn") return v > .6 ? [68 + light, 118 + light, 43 + light * .4] : [85 + light, 76 + light, 40];
  if (kind === "swings") {
    if (v < .32 && u > .2 && u < .8) return [176 + light, 107 + light, 42];
    if (v < .9 && (Math.abs(u - .37) < .04 || Math.abs(u - .63) < .04 || Math.abs(u - .24) < .04 || Math.abs(u - .76) < .04)) return [179 + light, 184 + light, 174 + light];
    return [42 + light, 97 + light, 93 + light];
  }
  if (kind === "playground") return v > .78 ? [179 + light, 67 + light, 40] :
    u > .4 ? [214 + light, 161 + light, 56] : [53 + light, 110 + light, 131 + light];
  if (v > .88) return [230 + light, 224 + light, 177 + light];
  if (v > .22 && u > .24 && u < .76) return [225 + light, 230 + light, 216 + light];
  if (u < .18 || u > .82) return Math.floor(v * 18) % 2 ? [142 + light, 75 + light, 57] : [180 + light, 160 + light, 133];
  if (v > .16) return Math.abs(u - .5) < .024 || Math.abs(u - .12) < .015 || Math.abs(u - .88) < .015 ?
    [219 + light, 230 + light, 199 + light] : [61 + light, 114 + light + Math.floor(u * 12) % 2 * 12, 49 + light];
  return [135 + light, 99 + light, 66 + light];
}
