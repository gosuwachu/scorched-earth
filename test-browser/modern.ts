import { Config } from "../src/config";
import { createGameState, AIM } from "../src/game";
import { Renderer } from "../src/render";
import { Surface } from "../src/pygame";
import { warmModernAssets } from "../src/modern_render";
import { save, load, apply, type SaveGameState } from "../src/savegame";

export async function scene(biome: string, layout: string, seed = 71) {
  await warmModernAssets();
  const cfg = Object.assign(new Config(), { TERRAIN_STYLE: "MODERN", TERRAIN_BIOME: biome, TERRAIN_LAYOUT: layout, INITIAL_CASH: 0, SOUND: "OFF", MAX_WIND: 0, SKY: "PLAIN", ELASTIC: "NONE" });
  const start = performance.now();
  const gs = createGameState(cfg, 1024, 768, seed);
  gs.add_player("Player 1", 0, 0, 0); gs.add_player("Player 2", 0, 0, 1); gs.new_game();
  for (let i = 0; i < 10 && gs.phase !== AIM; i++) gs.update(1 / 60);
  const generationMs = performance.now() - start;
  const renderer = new Renderer(cfg, gs.w, gs.h), surf = new Surface([gs.w, gs.h]);
  const page = document.getElementById("game") as HTMLCanvasElement;
  page.width = gs.w * 2; page.height = gs.h * 2; page.style.width = "1024px"; page.style.height = "768px";
  const render = () => { renderer.render(surf, gs as unknown as Parameters<Renderer["render"]>[1]); page.getContext("2d")!.drawImage(renderer.modernFrame!, 0, 0); };
  const t0 = performance.now(); render(); const firstRenderMs = performance.now() - t0;
  const frames: number[] = [];
  for (let i = 0; i < 30; i++) { const t = performance.now(); render(); frames.push(performance.now() - t); }
  const world = gs.terrain.modern!;
  const fire = (slot = 0) => {
    const tank = gs.current_shooter!; tank.angle = tank.x < gs.w / 2 ? 35 : 145; tank.power = 330; tank.selected_weapon = slot; tank.inventory[slot] = 2;
    const before = world.cells.slice(); gs.fire();
    let steps = 0, visibleFrames = 0, changedPixels = 0;
    const captures: Record<string, string> = {};
    for (; steps < 2400; steps++) {
      gs.update(1 / 60);
      const blast = gs.projectiles.find(p => p.weaponEffect?.kind === "blast")?.weaponEffect;
      if (blast?.kind === "blast") {
        visibleFrames++;
        const phase = blast.phase;
        if (!captures[phase] && blast.grown >= blast.radius * .5) {
          const projectiles = gs.projectiles;
          gs.projectiles = []; render();
          const beforeFx = page.getContext("2d")!.getImageData(0, 0, page.width, page.height).data;
          gs.projectiles = projectiles; render();
          const afterFx = page.getContext("2d")!.getImageData(0, 0, page.width, page.height).data;
          let different = 0;
          for (let i = 0; i < beforeFx.length; i += 4) if (afterFx[i+3] === 255 && Math.abs(afterFx[i]-beforeFx[i]) + Math.abs(afterFx[i+1]-beforeFx[i+1]) + Math.abs(afterFx[i+2]-beforeFx[i+2]) > 60) different++;
          changedPixels = Math.max(changedPixels, different);
          captures[phase] = page.toDataURL("image/png");
        }
      }
      if (!gs.projectiles.length && !gs.explosions.length && steps > 10) break;
    }
    render();
    return {steps, changed: before.some((v, i) => v !== world.cells[i]), projectiles: gs.projectiles.length, visibleFrames, changedPixels, captures};
  };
  const crater = () => {
    const p = world.props.find(p => p.kind === "tower" || p.kind === "house");
    const x = p?.x ?? 512, y = p?.y ?? gs.terrain.column_top(512);
    const t = performance.now(); gs.terrain.carve_circle(x, y - 5, 42); world.settle(); const destructionMs = performance.now() - t;
    const r = performance.now(); render(); return {destructionMs, renderMs: performance.now() - r};
  };
  const roundtrip = () => {
    const view = { ...gs, terrain: { modern: world, grid: {w: gs.w, h: gs.h, data: gs.terrain.grid} } } as unknown as SaveGameState;
    const data = load(save(view), "modern"); apply(data, view);
    return world.cells.every((v, i) => v === view.terrain.modern!.cells[i]);
  };
  Object.assign(window, { modernTest: {gs, renderer, render, fire, crater, roundtrip} });
  return { biome, layout, seed, generationMs, firstRenderMs, cachedRenderMs: frames.reduce((a,b)=>a+b,0)/frames.length, props: world.props.length, cells: world.cells.length };
}
