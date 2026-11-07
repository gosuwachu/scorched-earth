/** Stylised landmark silhouettes, in normalized coordinates (base y=0).
 * Shared by collision generation and the facade renderer. */
export const CITY_BUILDINGS = ["office", "apartment", "shop", "warehouse", "st_pauls", "big_ben", "london_eye", "bloomberg", "gherkin", "bridge", "golden_gate", "lighthouse", "detached", "semi", "townhouse"] as const;
export type CityBuilding = typeof CITY_BUILDINGS[number];
export const CITY_LANDMARKS: CityBuilding[] = ["st_pauls", "big_ben", "london_eye", "bloomberg", "gherkin", "lighthouse"];
export function isCityBuilding(kind: string): kind is CityBuilding {
  return (CITY_BUILDINGS as readonly string[]).includes(kind);
}
export function suspensionCable(x: number): number {
  return Math.abs(x) <= .28 ? .46 + .45 * (x / .28) ** 2 : .91 - (Math.abs(x) - .28) * 2.4;
}
export function cityContains(kind: CityBuilding, x: number, y: number): boolean {
  if (x < -.5 || x >= .5 || y <= 0 || y > 1) return false;
  const ax = Math.abs(x);
  switch (kind) {
    case "office": return y < .88 || ax < .34;
    case "st_pauls": return y < .34 || ax < .23 && y < .53 ||
      y >= .53 && (x / .25) ** 2 + ((y - .53) / .3) ** 2 < 1 ||
      ax < .035 && y < .94 || ax < .012 || y > .94 && y < .96 && ax < .05 ||
      Math.abs(ax - .4) < .065 && y < .57 ||
      ((ax - .4) / .065) ** 2 + ((y - .57) / .1) ** 2 < 1 || Math.abs(ax - .4) < .014 && y < .71;
    case "big_ben": return ax < .3 && y < .72 || ax < .38 && y >= .66 && y < .82 ||
      y >= .82 && ax < .3 * (1 - y) / .18;
    case "gherkin": return ax < .46 * Math.sin(Math.PI * (.11 + .89 * y)) ** .65;
    case "london_eye": {
      const rx = x / .46, ry = (y - .55) / .43, r = Math.hypot(rx, ry);
      const angle = Math.atan2(ry, rx);
      const rim = Math.abs(r - 1) < .028;
      const spoke = r < 1 && Math.abs(Math.sin(angle * 12)) * r < .16;
      const pod = Math.abs(r - 1) < .065 && Math.abs(Math.sin(angle * 12)) < .17;
      return rim || spoke || pod || r < .065 ||
        y < .55 && Math.abs(ax - .28 * (1 - y / .55)) < .022 || y < .03 && ax < .34;
    }
    case "bloomberg": return y < .87 || ax < .43;
    case "bridge": return y > .74 || ax > .4 || y > .64 * Math.sqrt(Math.max(0, 1 - (x / .4) ** 2));
    case "golden_gate": {
      const cable = suspensionCable(x);
      const pier = Math.abs(ax - .28);
      const tx = (ax - .28) / .035;
      const brace = (lo: number, hi: number) => y > lo && y < hi &&
        Math.abs(Math.abs(tx) - Math.abs(2 * (y - lo) / (hi - lo) - 1)) < .16;
      const tower = pier < .035 && y < .96 && (pier > .018 || y < .035 || y > .86 ||
        y > .66 && y < .7 || y > .45 && y < .49 || brace(.035, .3) || brace(.7, .86) || brace(.49, .66));
      const truss = Math.abs(x * 18 - Math.floor(x * 18) - .5) * 2;
      const deck = y > .32 && y < .35 || y > .265 && y < .275 ||
        y >= .275 && y <= .32 && Math.abs((y - .275) / .045 - truss) < .15;
      return deck || tower ||
        Math.abs(y - cable) < .012 || y > .35 && y < cable && Math.abs(x * 25 - Math.round(x * 25)) < .07 ||
        ax > .46 && y < .35;
    }
    case "lighthouse": return ax < .13 + (1 - y) * .16 && y < .79 || ax < .28 && y > .75 && y < .9 ||
      y >= .9 && ax < .28 * (1 - y) / .1;
    case "detached": return y < .58 && ax < .43 || y >= .58 && y < .94 - ax * .7 || x > .22 && x < .3 && y < 1;
    case "semi": return y < .64 || y < .96 - Math.abs(ax - .25) * 1.1 || ax < .045;
    case "townhouse": return y < .9 || ax < .44 && y < .96 || ax > .32 && ax < .42;
    default: return true;
  }
}
