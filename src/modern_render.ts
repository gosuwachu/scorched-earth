import { drawModernTank, drawModernBlast } from "./modern_art";
import type { GameState } from "./render";
import { ITEMS } from "./weapons";
/** Cached half-unit raster terrain with painted distant scenery. DOM is lazy. */
import masks from "./modern_masks.json";
import { ModernWorld, hash, type Prop } from "./modern";
import type { Surface } from "./pygame";
const images = new Map<string, HTMLImageElement>();
let texture: ImageData | null = null;
let spritePixels: ImageData | null = null;
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
    } };
    img.src = `/assets/modern/${name}.png`;
  }
  return img;
}
export async function warmModernAssets(): Promise<void> {
  await Promise.all(["alpine", "desert", "swamp", "cave", "city", "earth", "props"].map(name => asset(name).decode().catch(() => {})));
}
function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
type RGB = [number, number, number];
function propColor(p: Prop, x: number, y: number, seed: number): RGB {
  const dx = x - (p.x - p.w / 2), dy = p.y - y, u = dx / p.w, v = dy / p.h;
  if (spritePixels) {
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
  private base!: HTMLCanvasElement;
  frame!: HTMLCanvasElement;
  private tileVersions = new Uint32Array(0);
  private assetVersion = -1;
  private lastVersion = -1;
  private flash: HTMLCanvasElement | null = null;
  private pixelTile: ImageData | null = null;
  prepare(world: ModernWorld, surf: Surface): void {
    if (world !== this.world) {
      this.world = world;
      this.terrain = canvas(world.fw, world.fh); this.base = canvas(world.fw, world.fh); this.frame = canvas(world.fw, world.fh);
      this.tileVersions = new Uint32Array(world.tileVersions.length); this.lastVersion = -1; this.flash = null;
    }
    const bg = asset(world.layout === "CITY" ? "city" : world.layout === "CAVE" ? "cave" : world.biome === "SWAMP" ? "swamp" : world.biome === "DESERT" ? "desert" : "alpine");
    asset("earth"); asset("props");
    const refresh = this.assetVersion !== assetsVersion;
    if (world.version !== this.lastVersion || refresh) {
      this.updateTiles(world, refresh);
      const ctx = this.base.getContext("2d")!;
      const sky = ctx.createLinearGradient(0, 0, 0, world.fh);
      sky.addColorStop(0, world.biome === "DESERT" ? "#d9b58e" : world.layout === "CAVE" ? "#153e40" : "#69a9e1");
      sky.addColorStop(1, "#d5ded2"); ctx.fillStyle = sky; ctx.fillRect(0, 0, world.fw, world.fh);
      if (bg.complete && bg.naturalWidth) ctx.drawImage(bg, 0, 0, world.fw, world.fh);
      ctx.drawImage(this.terrain, 0, 0);
      this.assetVersion = assetsVersion; this.lastVersion = world.version;
    }
    // All existing effects and HUD draw in logical coordinates on a transparent overlay.
    surf.ctx.clearRect(0, 0, world.w, world.h);
  }
  finish(surf: Surface, brightness = 0, state?: GameState, hud = true): void {
    const m = this.world!;
    const ctx = this.frame.getContext("2d")!;
    ctx.clearRect(0, 0, m.fw, m.fh); ctx.drawImage(this.base, 0, 0);
    if (state) {
      ctx.save(); ctx.scale(2, 2);
      for (const tank of state.tanks) {
        if (!tank.alive) continue;
        const path = tank.chute_descent;
        const [x, y] = path ? path.path[Math.max(0, Math.min(path.path.length - 1, Math.trunc(path.i)))] : [tank.x, tank.y];
        const color = state.lut?.table[tank.color] ?? [75, 210, 230];
        drawModernTank(ctx, x, y, tank.half_width * 2, color, tank.angle, tank.tank_icon);
        const by = y - (tank.shield_hp > 0 ? 29 : 25);
        ctx.fillStyle = "#092133"; ctx.beginPath(); ctx.roundRect(x - 12, by, 24, 3, 1.5); ctx.fill();
        ctx.fillStyle = "#68dfbb"; ctx.beginPath(); ctx.roundRect(x - 11.5, by + .5, Math.max(0, 23 * tank.health / 100), 2, 1); ctx.fill();
        if (tank === state.current_shooter && state.phase === "aim") {
          ctx.fillStyle = "#8aecfb"; ctx.beginPath(); ctx.moveTo(x, by - 4); ctx.lineTo(x - 3, by - 8); ctx.lineTo(x + 3, by - 8); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore(); ctx.drawImage(this.terrain, 0, 0);
    }
    if (brightness > 0) {
      this.flash ??= canvas(m.fw, m.fh);
      const f = this.flash.getContext("2d")!;
      f.clearRect(0, 0, m.fw, m.fh); f.drawImage(this.terrain, 0, 0);
      f.globalCompositeOperation = "source-in"; f.fillStyle = `rgba(252,252,252,${Math.min(1, brightness)})`;
      f.fillRect(0, 0, m.fw, m.fh); f.globalCompositeOperation = "source-over";
      ctx.drawImage(this.flash, 0, 0);
    }
    ctx.imageSmoothingEnabled = true; ctx.drawImage(surf.canvas, 0, 0, m.fw, m.fh);
    if (state) {
      ctx.save(); ctx.scale(2, 2);
      for (const projectile of state.projectiles) {
        const effect = projectile.weaponEffect;
        if (effect?.kind === "blast") drawModernBlast(ctx, effect.x, effect.y, effect.radius,
          effect.phase === "erase" ? effect.clock : effect.cycle, effect.grown / effect.radius, effect.plasma, effect.phase === "erase");
        else if (effect?.kind === "funky") for (const burst of effect.bursts) drawModernBlast(ctx, burst.x, burst.y, burst.radius, effect.hold, burst.grown / burst.radius);
        else if (effect?.kind === "sandhog") for (const charge of effect.charges) drawModernBlast(ctx, charge.x, charge.y, 5, 0, 1);
      }
      if (hud && state.cfg.is_on("ICON_BAR")) this.hud(ctx, state, m.w);
      ctx.restore();
    }
    surf.ctx.drawImage(this.frame, 0, 0, m.w, m.h);
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
      text("ANGLE", width * .215); text(`${Math.round(t.angle)}°`, width * .305, "#62e3f5");
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
    for (let tx = 0; tx < m.tilesX; tx++) for (let ty = 0; ty < m.tilesY; ty++) {
      const t = tx * m.tilesY + ty;
      // Include neighbor tiles: a crater can expose an edge in an unchanged tile.
      let version = m.tileVersions[t];
      for (let nx = Math.max(0, tx - 1); nx <= Math.min(m.tilesX - 1, tx + 1); nx++)
        for (let ny = Math.max(0, ty - 1); ny <= Math.min(m.tilesY - 1, ty + 1); ny++) version = Math.max(version, m.tileVersions[nx * m.tilesY + ny]);
      if (!all && this.tileVersions[t] === version) continue;
      this.tileVersions[t] = version; pixels.fill(0);
      for (let xx = 0; xx < 128 && tx * 128 + xx < m.fw; xx++) {
        const x = tx * 128 + xx;
        for (let yy = 0; yy < 128 && ty * 128 + yy < m.fh; yy++) {
          const y = ty * 128 + yy, index = x * m.fh + y, material = m.cells[index];
          if (!material) continue;
          let color: RGB;
          if (material >= 16) color = propColor(m.props[material - 16], x / 2, y / 2, m.seed);
          else {
            const n = hash(x, y, m.seed);
            const band = Math.sin(y * 0.045 + Math.sin(x * 0.007) * 2 + Math.sin(x * 0.023) * 0.35) * 11;
            let tex = 0;
            if (texture) { const i = ((y % texture.height) * texture.width + x % texture.width) * 4; tex = (texture.data[i] * 0.3 + texture.data[i + 1] * 0.6 + texture.data[i + 2] * 0.1 - 100) * 0.85; }
            const detail = tex + band + (n - 0.5) * 7;
            color = m.biome === "DESERT" ? [163 + detail, 96 + detail * 0.85, 47 + detail * 0.7] :
              material === 2 ? [87 + detail * 0.8, 88 + detail * 0.8, 87 + detail * 0.85] :
              m.biome === "SWAMP" ? [83 + detail, 70 + detail * 0.85, 45 + detail * 0.7] : [127 + detail, 92 + detail * 0.85, 57 + detail * 0.7];
            // Only natural soil carries turf; fresh deposited soil remains bare.
            const above = (d: number) => y >= d && m.cells[index - d] === 0;
            if (material === 1 && (above(1) || above(4) || above(8) || above(12))) {
              color = m.biome === "SNOW" ? [218 + n * 27, 233 + n * 20, 241 + n * 14] :
                m.biome === "DESERT" ? [226 + detail * 0.4, 166 + detail * 0.5, 81 + detail * 0.5] :
                [83 + n * 48, 117 + n * 55, 35 + n * 25];
            }
            if (above(1) || x > 0 && !m.cells[index - m.fh]) color = color.map(c => c + 19) as RGB;
            if (y + 2 < m.fh && !m.cells[index + 2]) color = color.map(c => c * 0.66) as RGB;
          }
          const i = (yy * 128 + xx) * 4;
          pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = 255;
        }
      }
      ctx.putImageData(tile, tx * 128, ty * 128);
    }
  }
}
