import { drawModernTank, drawModernBlast } from "./modern_art";
import { sandstoneColor } from "./desert";
import { TerrainDepth, RockReliefCache, caveShade } from "./terrain_depth";
import type { BlastEffect } from "./combat_effects";
import type { GameState } from "./render";
import { ITEMS } from "./weapons";
import { hudAngle } from "./angles";
/** Cached half-unit raster terrain with painted distant scenery. DOM is lazy. */
import masks from "./modern_masks.json";
import { landmarkMasks } from "./landmark_masks";
import { PAINTED_ART, paintedMasks, paintedSample, paintedTexture } from "./painted_sprites";
import { ModernWorld, hash, isCityBuilding, type Prop } from "./modern";
import { buildingColor } from "./modern_buildings";
import { isParkProp, parkColor } from "./city_parks";
import { rockColor } from "./modern_rocks";
import { alpineRockColor } from "./alpine_rocks";
import type { Surface } from "./pygame";
const images = new Map<string, HTMLImageElement>();
let texture: ImageData | null = null;
let spritePixels: ImageData | null = null;
const landmarkPixels = new Map<string, ImageData>();
const paintedSpritePixels = new Map<string, ImageData>();
let assetsVersion = 0;
function asset(name: string): HTMLImageElement {
  let img = images.get(name);
  if (!img) {
    img = new Image(); images.set(name, img);
    img.onload = () => { assetsVersion++; if (name === "earth") {
      const c = canvas(768, 512); c.getContext("2d")!.drawImage(img!, 0, 0, 768, 512);
      texture = c.getContext("2d")!.getImageData(0, 0, 768, 512);
    } else if (name === "props") {
      const c = canvas(img!.naturalWidth, img!.naturalHeight); c.getContext("2d")!.drawImage(img!, 0, 0);
      spritePixels = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    } else if (name.startsWith("buildings-v2/") || name.startsWith("props-v2/")) {
      const c = canvas(img!.naturalWidth, img!.naturalHeight); c.getContext("2d")!.drawImage(img!, 0, 0);
      paintedSpritePixels.set(name.split("/")[1], c.getContext("2d")!.getImageData(0, 0, c.width, c.height));
    } else if (landmarkMasks[name]) {
      const c = canvas(img!.naturalWidth, img!.naturalHeight); c.getContext("2d")!.drawImage(img!, 0, 0);
      landmarkPixels.set(name, c.getContext("2d")!.getImageData(0, 0, c.width, c.height));
    } };
    img.src = `/assets/modern/${name}.${name.includes("-v2/") ? "webp" : "png"}`;
  }
  return img;
}
export async function warmModernAssets(includeScenery = false): Promise<void> {
  const scenery = includeScenery ? Object.keys(paintedMasks).map(paintedTexture) : [];
  await Promise.all(["alpine", "desert", "swamp", "cave", "city", "earth", "props", ...scenery].map(name => asset(name).decode().catch(() => {})));
}
function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
type RGB = [number, number, number];
function propColor(p: Prop, x: number, y: number, seed: number, biome: ModernWorld["biome"]): RGB {
  const painted = paintedMasks[p.kind], paintedPixels = paintedSpritePixels.get(p.kind);
  if (p.art === PAINTED_ART && painted && paintedPixels) {
    const [bx, by, bw, bh] = painted.bounds;
    const u = (x - p.x + p.w / 2) / p.w, v = (y - p.y + p.h) / p.h;
    const [ix, iy] = paintedSample(p.kind, u, v);
    const sx = Math.floor(bx + (Math.max(0, Math.min(painted.size - 1, ix)) + .5) * bw / painted.size);
    const sy = Math.floor(by + (Math.max(0, Math.min(painted.size - 1, iy)) + .5) * bh / painted.size);
    const offset = (sy * paintedPixels.width + sx) * 4;
    return [paintedPixels.data[offset], paintedPixels.data[offset + 1], paintedPixels.data[offset + 2]];
  }
  const landmark = landmarkMasks[p.kind], pixels = landmarkPixels.get(p.kind);
  if (p.art === "illustrated-v1" && landmark && pixels) {
    const size = landmark.rows.length, [bx, by, bw, bh] = landmark.bounds;
    const u = (x - p.x + p.w / 2) / p.w, v = (y - p.y + p.h) / p.h;
    const ix = Math.max(0, Math.min(size - 1, Math.floor(u * size)));
    const iy = Math.max(0, Math.min(size - 1, Math.floor(v * size)));
    const sx = Math.floor(bx + (ix + .5) * bw / size), sy = Math.floor(by + (iy + .5) * bh / size);
    const offset = (sy * pixels.width + sx) * 4;
    return [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
  }
  if (isCityBuilding(p.kind)) return buildingColor(p, x, y, seed);
  const dx = x - (p.x - p.w / 2), dy = p.y - y, u = dx / p.w, v = dy / p.h;
  if (isParkProp(p.kind)) return parkColor(p.kind, u, v, hash(Math.floor(x * 2), Math.floor(y * 2), seed));
  if (p.kind === "rock") {
    const grain = hash(Math.floor(x * 2), Math.floor(y * 2), seed);
    return biome === "GRASS" || biome === "SNOW" ? alpineRockColor(u, v, p.variant, grain, biome === "SNOW") : rockColor(u, v, p.variant, grain);
  }
  if (spritePixels && p.art !== PAINTED_ART) {
    const [bx, by, bw, bh] = masks[p.kind].bounds;
    const ix = Math.max(0, Math.min(127, Math.floor(u * 128))), iy = Math.max(0, Math.min(127, Math.floor((1 - v) * 128)));
    const sx = Math.floor(bx + (ix + 0.5) * bw / 128), sy = Math.floor(by + (iy + 0.5) * bh / 128);
    const offset = (sy * spritePixels.width + sx) * 4;
    return [spritePixels.data[offset], spritePixels.data[offset + 1], spritePixels.data[offset + 2]];
  }
  const n = hash(Math.floor(x * 3), Math.floor(y * 3), seed), light = (1 - u) * 25 + n * 19;
  if (p.kind === "pine" || p.kind === "tree" || p.kind === "cactus") {
    if (v < 0.25 && p.kind !== "cactus") return [78 + light, 61 + light * 0.6, 35];
    const branch = Math.sin((dy + Math.abs(dx - p.w / 2) * 1.4) * 1.6) * 12;
    return [35 + light + branch, 70 + light * 1.6 + branch, 30 + light * 0.5];
  }
  if (p.kind === "house") {
    if (v > 0.64) { const shingle = Math.floor(dx / 4 + Math.floor(dy / 3) % 2) % 2 * 15; return [83 + light + shingle, 52 + light, 37 + light * 0.6]; }
    if (Math.abs(u - 0.52) < 0.1 && v < 0.43) return [48, 34, 27];
    if ((Math.abs(u - 0.23) < 0.09 || Math.abs(u - 0.78) < 0.09) && v > 0.3 && v < 0.52) return [250, 203, 115];
    const plank = Math.floor(dy) % 4 === 0 ? -28 : 0;
    return [143 + light + plank, 101 + light + plank, 61 + light * 0.7 + plank];
  }
  if (p.kind === "tower") {
    const col = Math.floor(dx / 7), row = Math.floor(dy / 9);
    if (dx % 7 < 1.2 || dy % 9 < 1.3 || v > 0.94) return [67 + light, 74 + light, 86 + light];
    if (hash(col, row, p.id + seed) > 0.58) return [232 + n * 20, 178 + n * 25, 99 + n * 35];
    return [43 + light * 0.7, 70 + light, 102 + light * 1.2];
  }
  if (p.kind === "car") {
    if (v < 0.23 && (Math.abs(u - 0.22) < 0.12 || Math.abs(u - 0.78) < 0.12)) return [32, 35, 39];
    if (v > 0.55) return [107 + light, 164 + light, 182 + light];
    return p.variant > 0.5 ? [160 + light, 48 + light, 39 + light] : [142 + light, 150 + light, 153 + light];
  }
  return [134 + light, 91 + light * 0.8, 51 + light * 0.6];
}
export class ModernRenderer {
  private world: ModernWorld | null = null;
  private terrain!: HTMLCanvasElement;
  private cutTerrain!: HTMLCanvasElement;
  private debris = new WeakMap<BlastEffect, Array<{ x: number; y: number; color: string; size: number }>>();
  private base!: HTMLCanvasElement;
  private cave!: HTMLCanvasElement;
  frame!: HTMLCanvasElement;
  private tileVersions = new Uint32Array(0);
  private assetVersion = -1;
  private lastVersion = -1;
  private flash: HTMLCanvasElement | null = null;
  private pixelTile: ImageData | null = null;
  private depth = new TerrainDepth();
  private relief!: RockReliefCache;
  prepare(world: ModernWorld, surf: Surface): void {
    if (world !== this.world) {
      this.world = world;
      this.relief = new RockReliefCache(world.w, world.h, world.seed);
      this.cutTerrain = canvas(world.fw, world.fh);
      this.cave = canvas(Math.ceil(world.fw / 4), Math.ceil(world.fh / 4));
      this.debris = new WeakMap();
      this.terrain = canvas(world.fw, world.fh); this.base = canvas(world.fw, world.fh); this.frame = canvas(world.fw, world.fh);
      this.tileVersions = new Uint32Array(world.tileVersions.length); this.lastVersion = -1; this.flash = null;
    }
    const bg = asset(world.layout === "CITY" ? "city" : world.layout === "CAVE" ? "cave" : world.biome === "SWAMP" ? "swamp" : world.biome === "DESERT" ? "desert" : "alpine");
    asset("earth"); asset("props");
    for (const p of world.props) {
      if (p.art === PAINTED_ART) asset(paintedTexture(p.kind));
      else if (p.art === "illustrated-v1") asset(p.kind);
    }
    const refresh = this.assetVersion !== assetsVersion;
    if (world.version !== this.lastVersion || refresh) {
      this.updateTiles(world, refresh);
      const ctx = this.base.getContext("2d")!;
      const sky = ctx.createLinearGradient(0, 0, 0, world.fh);
      sky.addColorStop(0, world.biome === "DESERT" ? "#d9b58e" : world.layout === "CAVE" ? "#153e40" : "#69a9e1");
      sky.addColorStop(1, "#d5ded2"); ctx.fillStyle = sky; ctx.fillRect(0, 0, world.fw, world.fh);
      if (bg.complete && bg.naturalWidth) ctx.drawImage(bg, 0, 0, world.fw, world.fh);
      // Atmospheric perspective belongs behind collision geometry and tanks.
      const haze = ctx.createLinearGradient(0, 0, 0, world.fh);
      const tint = world.biome === "DESERT" ? "239,204,173" : world.layout === "CAVE" ? "80,115,119" : "183,207,221";
      haze.addColorStop(0, `rgba(${tint},0)`);
      haze.addColorStop(.45, `rgba(${tint},.12)`);
      haze.addColorStop(1, `rgba(${tint},.32)`);
      ctx.fillStyle = haze; ctx.fillRect(0, 0, world.fw, world.fh);
      const rear = this.cave.getContext("2d")!;
      const shade = caveShade(world.cells, world.fw, world.fh);
      const pixels = rear.createImageData(this.cave.width, this.cave.height);
      const rgb = world.biome === "DESERT" ? [92, 65, 54] : world.biome === "SWAMP" ? [38, 61, 58] : [52, 68, 79];
      for (let i = 0; i < shade.length; i++) {
        pixels.data[i * 4] = rgb[0]; pixels.data[i * 4 + 1] = rgb[1];
        pixels.data[i * 4 + 2] = rgb[2]; pixels.data[i * 4 + 3] = shade[i];
      }
      rear.putImageData(pixels, 0, 0);
      ctx.drawImage(this.cave, 0, 0, world.fw, world.fh);
      this.assetVersion = assetsVersion; this.lastVersion = world.version;
    }
    // All existing effects and HUD draw in logical coordinates on a transparent overlay.
    surf.ctx.clearRect(0, 0, world.w, world.h);
  }
  finish(surf: Surface, brightness = 0, state?: GameState, hud = true): void {
    const m = this.world!;
    const ctx = this.frame.getContext("2d")!;
    ctx.clearRect(0, 0, m.fw, m.fh); ctx.drawImage(this.base, 0, 0);
    // Visually disintegrate the ground at the advancing front. The simulation
    // still commits the crater at its normal cleanup step (including damage).
    const ground = this.cutTerrain.getContext("2d")!;
    ground.clearRect(0, 0, m.fw, m.fh); ground.drawImage(this.terrain, 0, 0);
    ground.save(); ground.scale(2, 2);
    for (const p of state?.projectiles ?? []) {
      const e = p.weaponEffect;
      if (e?.kind !== "blast" || e.plasma) continue;
      this.captureDebris(e);
      ground.globalCompositeOperation = "destination-out";
      ground.beginPath(); ground.arc(e.x, e.y, e.grown, 0, Math.PI * 2); ground.fill();
    }
    ground.restore();
    if (state) {
      ctx.save(); ctx.scale(2, 2);
      for (const tank of state.tanks) {
        if (!tank.alive) continue;
        const path = tank.chute_descent;
        const [x, y] = path ? path.path[Math.max(0, Math.min(path.path.length - 1, Math.trunc(path.i)))] : [tank.x, tank.y];
        const color = state.lut?.table[tank.color] ?? [75, 210, 230];
        drawModernTank(ctx, x, y, tank.half_width * 2, color, tank.angle, tank.tank_icon);
        // Match Classic descent: keep overhead markers out of the parachute.
        if (path) continue;
        const by = y - (tank.shield_hp > 0 ? 29 : 25);
        ctx.fillStyle = "#092133"; ctx.beginPath(); ctx.roundRect(x - 12, by, 24, 3, 1.5); ctx.fill();
        ctx.fillStyle = "#68dfbb"; ctx.beginPath(); ctx.roundRect(x - 11.5, by + .5, Math.max(0, 23 * tank.health / 100), 2, 1); ctx.fill();
        if (tank === state.current_shooter && state.phase === "aim") {
          ctx.fillStyle = "#8aecfb"; ctx.beginPath(); ctx.moveTo(x, by - 4); ctx.lineTo(x - 3, by - 8); ctx.lineTo(x + 3, by - 8); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.drawImage(this.cutTerrain, 0, 0);
    if (brightness > 0) {
      this.flash ??= canvas(m.fw, m.fh);
      const f = this.flash.getContext("2d")!;
      f.clearRect(0, 0, m.fw, m.fh); f.drawImage(this.cutTerrain, 0, 0);
      f.globalCompositeOperation = "source-in"; f.fillStyle = `rgba(252,252,252,${Math.min(1, brightness)})`;
      f.fillRect(0, 0, m.fw, m.fh); f.globalCompositeOperation = "source-over";
      ctx.drawImage(this.flash, 0, 0);
    }
    ctx.imageSmoothingEnabled = true; ctx.drawImage(surf.canvas, 0, 0, m.fw, m.fh);
    if (state) {
      ctx.save(); ctx.scale(2, 2);
      for (const projectile of state.projectiles) {
        const effect = projectile.weaponEffect;
        if (effect?.kind === "blast") {
          drawModernBlast(ctx, effect.x, effect.y, effect.radius,
            effect.cycle, effect.grown / effect.radius, effect.plasma, effect.phase === "erase", effect.clock, effect.plasma ? 42 : effect.textured ? 10 : 25);
          this.drawDebris(ctx, effect);
        }
        else if (effect?.kind === "funky") for (const burst of effect.bursts) drawModernBlast(ctx, burst.x, burst.y, burst.radius, effect.age, burst.grown / burst.radius);
        else if (effect?.kind === "sandhog") for (const charge of effect.charges) drawModernBlast(ctx, charge.x, charge.y, 5, 5, 1);
      }
      if (hud && state.cfg.is_on("ICON_BAR")) this.hud(ctx, state, m.w);
      ctx.restore();
    }
    surf.ctx.drawImage(this.frame, 0, 0, m.w, m.h);
  }
  private captureDebris(e: BlastEffect): void {
    if (this.debris.has(e)) return;
    const m = this.world!, pieces: Array<{ x: number; y: number; color: string; size: number }> = [];
    // Bounded sampling of actual soil/props, including their painted colours.
    const left = Math.max(0, Math.floor((e.x - e.radius) * 2));
    const top = Math.max(0, Math.floor((e.y - e.radius) * 2));
    const width = Math.min(m.fw, Math.ceil((e.x + e.radius) * 2 + 1)) - left;
    const height = Math.min(m.fh, Math.ceil((e.y + e.radius) * 2 + 1)) - top;
    if (width > 0 && height > 0) {
      const pixels = this.terrain.getContext("2d")!.getImageData(left, top, width, height).data;
      const spacing = Math.max(3, e.radius / 12);
      for (let x = left / 2; x < (left + width) / 2; x += spacing) for (let y = top / 2; y < (top + height) / 2; y += spacing) {
        const dx = x - e.x, dy = y - e.y;
        if (dx * dx + dy * dy > e.radius * e.radius) continue;
        const i = (Math.floor(y * 2 - top) * width + Math.floor(x * 2 - left)) * 4;
        if (!pixels[i + 3]) continue;
        pieces.push({ x: dx, y: dy, color: `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})`, size: 1 + hash(Math.floor(x), Math.floor(y), m.seed) * 2.5 });
      }
    }
    this.debris.set(e, pieces);
  }
  private drawDebris(ctx: CanvasRenderingContext2D, e: BlastEffect): void {
    ctx.save();
    for (const p of this.debris.get(e) ?? []) {
      const distance = Math.hypot(p.x, p.y);
      if (distance > e.grown) continue;
      const t = e.cycle - distance / (e.radius < 40 ? 1 : 2);
      if (t < 0 || t >= 30) continue;
      const alpha = Math.min(1, (30 - t) / 12) * (e.phase === "erase" ? Math.max(0, 1 - e.clock / (e.textured ? 10 : 25)) : 1);
      const speed = 1.8 + p.size * .5;
      const x = e.x + p.x + p.x / Math.max(1, distance) * t * speed;
      const y = e.y + p.y + (p.y / Math.max(1, distance) * speed - .6) * t + .07 * t * t;
      ctx.globalAlpha = alpha; ctx.fillStyle = p.color;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * .08 + p.x);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
    }
    ctx.restore();
  }
  private hud(ctx: CanvasRenderingContext2D, state: GameState, width: number): void {
    const t = state.current_shooter;
    const bar = ctx.createLinearGradient(0, 0, 0, 34); bar.addColorStop(0, "#172b43"); bar.addColorStop(1, "#0b192b");
    ctx.fillStyle = bar; ctx.fillRect(0, 0, width, 34);
    ctx.fillStyle = "#35546a"; ctx.fillRect(0, 33.5, width, .5);
    ctx.strokeStyle = "#3b5064"; ctx.lineWidth = .6;
    for (const x of [.19, .38, .61, .89]) { ctx.beginPath(); ctx.moveTo(width*x, 9); ctx.lineTo(width*x, 25); ctx.stroke(); }
    const font = Math.max(8, Math.min(15, width / 68));
    ctx.textBaseline = "middle"; ctx.font = `700 ${font}px system-ui, sans-serif`;
    const text = (label: string, x: number, color = "#eaf1f7", max = width) => {ctx.fillStyle=color;ctx.fillText(label, x, 17, max);};
    if (t) {
      text("POWER", width * .024); text(String(Math.trunc(Number(t.power))), width * .116, "#62e3f5");
      const [elevation, side] = hudAngle(t.angle);
      text("ANGLE", width * .215); text(`${Math.round(elevation)}${side}`, width * .305, "#62e3f5");
      ctx.textAlign="center"; text(t.name.toUpperCase(), width * .495, "#62e3f5", width*.20); ctx.textAlign="left";
      text(ITEMS[t.selected_weapon]?.name.toUpperCase() ?? "", width * .635, "#eaf1f7", width*.23);
    }
    const wind = Number(state.cfg.wind) || 0;
    const x = width * .93;
    ctx.strokeStyle="#8edcf2"; ctx.fillStyle="#8edcf2";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x-12,17);ctx.lineTo(x+12,17);ctx.stroke();
    const tip = wind < 0 ? x - 12 : x + 12, direction = wind < 0 ? -1 : 1;
    ctx.beginPath();ctx.moveTo(tip,17);ctx.lineTo(tip-direction*6,13);ctx.lineTo(tip-direction*6,21);ctx.closePath();ctx.fill();
    ctx.font=`600 ${Math.max(7,font-5)}px system-ui,sans-serif`;ctx.textAlign="center";ctx.fillText(String(Math.abs(wind)),x,28);ctx.textAlign="left";
  }
  private updateTiles(m: ModernWorld, all: boolean): void {
    const ctx = this.terrain.getContext("2d")!;
    this.pixelTile ??= ctx.createImageData(128, 128);
    const tile = this.pixelTile, pixels = tile.data;
    const lawns = m.props.filter(p => p.kind === "lawn");
    for (let tx = 0; tx < m.tilesX; tx++) for (let ty = 0; ty < m.tilesY; ty++) {
      const t = tx * m.tilesY + ty;
      // Include neighbors because a crater can expose an unchanged tile edge.
      let version = m.tileVersions[t];
      for (let nx = Math.max(0, tx - 1); nx <= Math.min(m.tilesX - 1, tx + 1); nx++)
        for (let ny = Math.max(0, ty - 1); ny <= Math.min(m.tilesY - 1, ty + 1); ny++) version = Math.max(version, m.tileVersions[nx * m.tilesY + ny]);
      if (!all && this.tileVersions[t] === version) continue;
      this.tileVersions[t] = version; pixels.fill(0);
      this.depth.update(m.cells, m.fw, m.fh, tx * 128, ty * 128);
      for (let xx = 0; xx < 128 && tx * 128 + xx < m.fw; xx++) {
        const x = tx * 128 + xx;
        const lawn = lawns.find(p => Math.abs(x / 2 - p.x) < p.w / 2);
        for (let yy = 0; yy < 128 && ty * 128 + yy < m.fh; yy++) {
          const y = ty * 128 + yy, index = x * m.fh + y, material = m.cells[index];
          if (!material) continue;
          let color: RGB;
          if (material >= 16) color = propColor(m.props[material - 16], x / 2, y / 2, m.seed, m.biome);
          else {
            const sample = yy * 128 + xx;
            const n = hash(x, y, m.seed);
            const band = Math.sin(y * 0.045 + Math.sin(x * 0.007) * 2 + Math.sin(x * 0.023) * 0.35) * 11;
            let tex = 0;
            if (texture) { const i = ((y % texture.height) * texture.width + x % texture.width) * 4; tex = (texture.data[i] * 0.3 + texture.data[i + 1] * 0.6 + texture.data[i + 2] * 0.1 - 100) * 0.85; }
            const relief = material === 2 && m.biome !== "DESERT" ? this.relief.sample(x / 2, y / 2).light : 0;
            const detail = tex * .65 + band * .5 + relief + (n - 0.5) * 7;
            color = m.biome === "DESERT" ? sandstoneColor(x / 2, y / 2, m.seed, n, tex, this.relief.sample(x / 2, y / 2)) :
              material === 2 ? [100 + detail * 0.8, 110 + detail * 0.8, 116 + detail * 0.85] :
              m.biome === "SWAMP" ? [83 + detail, 70 + detail * 0.85, 45 + detail * 0.7] : [127 + detail, 92 + detail * 0.85, 57 + detail * 0.7];
            // Only natural soil carries turf; fresh deposited soil remains bare.
            const above = (d: number) => y >= d && m.cells[index - d] === 0;
            // Sand collects on shelves, not as a yellow outline down every wall.
            const sandShelf = m.biome !== "DESERT" || x >= 8 && x + 8 < m.fw &&
              m.cells[index - 8 * m.fh] !== 0 && m.cells[index + 8 * m.fh] !== 0;
            if (material === 1 && sandShelf && (above(1) || above(4) || m.biome !== "DESERT" && (above(8) || above(12)))) {
              color = m.biome === "SNOW" ? [218 + n * 27, 233 + n * 20, 241 + n * 14] :
                m.biome === "DESERT" ? [226 + detail * 0.4, 166 + detail * 0.5, 81 + detail * 0.5] :
                [83 + n * 48, 117 + n * 55, 35 + n * 25];
            }
            if (material === 1 && lawn && (above(1) || above(4) || above(8))) {
              color = parkColor("lawn", 0.5, 1, n);
            }
            const top = this.depth.top[sample];
            const cap = 7 + Math.sin(x * .065) * 2 + Math.sin(x * .019) * 2;
            // A thicker sandy cap and shaded lip, entirely inside the mask.
            // Freshly exposed rock also gets a bevel; deposited rubble stays bare.
            if (m.biome === "DESERT" && material !== 3 &&
              top < cap + 5 && top < this.depth.left[sample] && top < this.depth.right[sample]) {
              if (top < cap) {
                const mix = .72 * (1 - top / (cap * 1.8));
                color = color.map((c, k) => c * (1 - mix) + [241, 183, 101][k] * mix) as RGB;
              } else color = color.map(c => c * .84) as RGB;
            }
            const light = this.depth.light(sample);
            color = [color[0] + light, color[1] + light * .92, color[2] + light * .78];
          }
          const i = (yy * 128 + xx) * 4;
          pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
        }
      }
      ctx.putImageData(tile, tx * 128, ty * 128);
    }
  }
}
