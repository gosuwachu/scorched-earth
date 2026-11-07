import { Config } from "../src/config";
import { createGameState } from "../src/game";
import { ModernWorld } from "../src/modern";
import type { CityBuilding } from "../src/city_shapes";
import { paintedAspect } from "../src/painted_sprites";
import { Renderer } from "../src/render";
import { Surface } from "../src/pygame";
import { warmModernAssets } from "../src/modern_render";

/** Controlled render/collision specimen, not a randomly generated city. */
export async function landmarkScene(kind: CityBuilding | "house" | "tower" | "pine" | "tree" | "cactus") {
  await warmModernAssets(true);
  const cfg = Object.assign(new Config(), { TERRAIN_STYLE: "MODERN", TERRAIN_LAYOUT: "CITY", INITIAL_CASH: 0, SOUND: "OFF" });
  const gs = createGameState(cfg, 640, 480, 17);
  gs.add_player("Landmark preview", 0, 0, 0); gs.add_player("Player 2", 0, 0, 1); gs.new_game();
  const m = new ModernWorld(640, 480, 17, "GRASS", "CITY");
  m.surface.fill(390);
  for (let x = 0; x < m.fw; x++) m.cells.fill(2, x * m.fh + 780, (x + 1) * m.fh);
  const width = kind === "golden_gate" || kind === "bridge" ? 310 : kind === "st_pauls" || kind === "bloomberg" ? 210 : kind === "london_eye" ? 220 : kind === "big_ben" || kind === "gherkin" ? 105 : 150;
  const aspect = paintedAspect(kind)!;
  const height = width / aspect;
  const p = m.stampCityProp(kind, (640 - width) / 2, width, height);
  const before = m.cells.reduce((sum, c) => sum + (c === p.id ? 1 : 0), 0);
  m.settle();
  const after = m.cells.reduce((sum, c) => sum + (c === p.id ? 1 : 0), 0);
  gs.terrain.modern = m; gs.terrain.grid = m.grid;
  gs.tanks.forEach((t, i) => { t.x = i ? 590 : 50; t.y = 389; });
  const renderer = new Renderer(cfg, 640, 480), surface = new Surface([640, 480]);
  renderer.render(surface, gs as unknown as Parameters<Renderer["render"]>[1]);
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  canvas.width = 1280; canvas.height = 960; canvas.style.width = "640px"; canvas.style.height = "480px";
  canvas.getContext("2d")!.drawImage(renderer.modernFrame!, 0, 0);
  return { kind, before, after, aspect, actualAspect: p.w / p.h };
}
