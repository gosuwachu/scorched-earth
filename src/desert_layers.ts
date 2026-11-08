import { desertProfile } from "./desert";

export type DesertColumn = {
  cliffTop: number; cliffFoot: number;
  sandBack: number; sandFront: number; bedBottom: number;
};

/** The desert is a stack of overlapping landforms, not horizontal colour
 * bands across a mountain. Coordinates are logical world units. The rear edge
 * of the sand is also the collision surface where no cliff rises above it. */
export class DesertLayers {
  readonly columns: DesertColumn[];
  constructor(readonly width: number, readonly height: number, seed: number) {
    const cliffs = desertProfile(width * 2, seed);
    this.columns = Array.from({ length: width * 2 }, (_, x) => {
      const u = x / (width * 2);
      // Broad valley floor and unequal, gently rolling aprons. The continuous
      // base leaves space for all four layers even beneath the deepest valley.
      const valley = Math.sin(u * Math.PI);
      const sandBack = height * (.57 + valley * .11 + Math.sin(u * 11 + seed) * .022);
      const sandFront = sandBack + height * (.065 + Math.sin(u * 17 + seed * .4) * .012);
      const bedBottom = sandFront + height * (.12 + Math.sin(u * 9 + seed * .7) * .014);
      const cliffTop = height * (.27 + cliffs[x] * .5);
      const cliffFoot = sandBack + height * (.018 + Math.sin(u * 23 + seed) * .005);
      return { cliffTop, cliffFoot, sandBack, sandFront, bedBottom };
    });
  }

  column(x: number): DesertColumn {
    return this.columns[Math.max(0, Math.min(this.columns.length - 1, Math.floor(x * 2)))];
  }

  surface(x: number): number {
    const c = this.column(x);
    return Math.min(c.sandBack, c.cliffTop);
  }

  /** Resolve the painter's stack: deep stone, beds, sand, then cliffs. Each
   * layer has its own boundary. Scenery is composited after this terrain. */
  sample(x: number, y: number): { layer: number; v: number; lip: number } {
    const c = this.column(x);
    let layer = 3, start = c.bedBottom, end = this.height * 1.05;
    if (y < c.bedBottom) { layer = 2; start = c.sandFront; end = c.bedBottom; }
    if (y < c.sandFront) { layer = 0; start = c.sandBack; end = c.sandFront; }
    if (c.cliffTop < c.sandBack && y < c.cliffFoot) {
      layer = 1; start = c.cliffTop; end = c.cliffFoot;
    }
    // Cliff/deep-rock fractures stay rigid in world space. Only sediment and
    // sand textures follow their own sheet; stretching a cliff texture from
    // each column's skyline to its foot would melt its ledges down the sides.
    const v = layer === 1 ? (y / this.height - .24) / .5 :
      layer === 3 ? (y / this.height - .65) / .4 : (y - start) / Math.max(1, end - start);
    // Contact shadow underneath the leading edge of the sand/bedding sheet.
    const lip = layer === 2 || layer === 3 ? Math.max(0, 1 - (y - start) / 4) : 0;
    return { layer, v, lip };
  }

  sandContains(x: number, y: number): boolean {
    const c = this.column(x);
    return y >= c.sandBack && y < c.sandFront && this.sample(x, y).layer === 0;
  }
}
