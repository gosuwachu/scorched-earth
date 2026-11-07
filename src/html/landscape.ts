import type { Config } from "../config";
import { el, field } from "./components";
import { warmModernAssets } from "../modern_render";

/** Shared local/host choice. LAN play is host-authoritative, not a second simulation. */
export function landscapeChoice(cfg: Config): HTMLFieldSetElement {
  const root = el("fieldset", "", "ui-landscape-choice");
  root.setAttribute("aria-label", "Landscape");
  const controls: HTMLSelectElement[] = [];
  const rows: Array<["TERRAIN_STYLE" | "TERRAIN_BIOME" | "TERRAIN_LAYOUT", string, string[], string[]]> = [
    ["TERRAIN_STYLE", "Terrain style", ["CLASSIC", "MODERN"], ["Classic", "Modern"]],
    ["TERRAIN_BIOME", "Biome", ["RANDOM", "GRASS", "SNOW", "DESERT", "SWAMP"], ["Random", "Grass", "Snow", "Desert", "Swamp"]],
    ["TERRAIN_LAYOUT", "Map layout", ["RANDOM", "MOUNTAINS", "CAVE", "CITY"], ["Random", "Mountains", "Cave", "City"]],
  ];
  const refresh = () => {
    controls.slice(1).forEach(c => { c.disabled = cfg.TERRAIN_STYLE !== "MODERN"; });
    if (cfg.TERRAIN_STYLE === "MODERN") void warmModernAssets();
  };
  for (const [key, label, values, labels] of rows) {
    const input = el("select"); input.setAttribute("aria-label", label);
    values.forEach((value, i) => { const option = el("option", labels[i]); option.value = value; input.append(option); });
    input.value = cfg[key]; input.onchange = () => { cfg[key] = input.value; refresh(); };
    controls.push(input); root.append(field(label, input));
  }
  refresh(); return root;
}
