import type { GameState } from "../src/game";
import { Renderer, setChooseTargetPredicate } from "../src/render";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import * as pg from "../src/pygame";
import * as C from "../src/constants";

function check(value: boolean, message: string): void {
  if (!value) throw new Error(`Projectile indicator: ${message}`);
}

function arrowPixels(surface: pg.Surface): number {
  const data = surface.ctx.getImageData(0, 0, surface.get_width(), surface.get_height()).data;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 255 && data[i + 1] === 235 && data[i + 2] === 40) count++;
  }
  return count;
}

function physicsSnapshot(gs: GameState): string {
  return JSON.stringify({ phase: gs.phase, timer: gs.timer, round: gs.round_index,
    projectiles: gs.projectiles.map((p) => [p.sx, p.sy, p.px, p.py, p.vx, p.vy, p.mode, p.active, p.state]),
    tanks: gs.tanks.map((t) => [t.x, t.y, t.health, t.cash, t.inventory]), trace: gs.trace_marks,
  });
}

/** Observe the text actually drawn, without replacing the canvas/font renderer. */
function labelsDrawnBy(renderer: Renderer): string[] {
  const labels: string[] = [];
  const font = (renderer as unknown as { _indicatorFont: pg.Font })._indicatorFont;
  const render = font.render.bind(font);
  font.render = (...args: Parameters<pg.Font["render"]>) => { labels.push(args[0]); return render(...args); };
  return labels;
}

/** Actual canvas and normal-launch checks for a browser visibility feature. */
export function projectileIndicatorStates(
  buildState: (sky?: string) => GameState,
  makeRenderer: (state: GameState) => Renderer,
  present: (surface: pg.Surface) => void,
): Record<string, () => Record<string, unknown>> {
  function demo(sky: string, hud = true, targeting = false): Record<string, unknown> {
    const gs = buildState(sky), surface = new pg.Surface([gs.w, gs.h]);
    gs.cfg.ICON_BAR = hud ? "ON" : "OFF";
    gs.cfg.STATUS_BAR = hud ? "ON" : "OFF";
    const renderer = makeRenderer(gs), labels = labelsDrawnBy(renderer);
    renderer.htmlDialogs = targeting;
    renderer.targetHud = targeting ? { left: 300, width: 400, height: 76, showAim: true, showWeapon: true } : null;
    setChooseTargetPredicate(() => targeting);
    try {
      const bar = targeting ? 76 : Renderer.BAR_H;
      const reserved = (hud ? bar + 18 : targeting ? bar : 0) + 6 + renderer.font.get_height() + 8;
      renderer.render(surface, gs, 0);
      const before = surface.ctx.getImageData(0, 0, gs.w, reserved).data;
      const background = [8, 10].map((x) => surface.get_at([x, 280]));
      gs.projectiles = [[512, -240], [526, -320], [-60, 280], [gs.w + 74, 400],
        [700, gs.h + 99], [-50, -50]].map(([x, y]) => new Projectile(gs.current_shooter, ITEMS[0], x, y, 0, 0));
      const snapshot = physicsSnapshot(gs);
      renderer.render(surface, gs, 25);
      check(physicsSnapshot(gs) === snapshot, "rendering changed physics or player state");
      const after = surface.ctx.getImageData(0, 0, gs.w, reserved).data;
      check(before.every((v, i) => v === after[i]), "marker overwrote HUD, targeting or wind space");
      check(labels.includes("2 missiles") && labels.includes("nearest 240 px"), "nearby missiles lack their count/distance");
      for (const label of ["60 px", "75 px", "100 px", "71 px"]) check(labels.includes(label), `missing edge/corner label ${label}`);
      const pixels = arrowPixels(surface);
      check(pixels > 125, `${sky} arrows are not clearly visible`);
      // Empty space around the left-edge arrow must leave the scene visible.
      for (const [i, x] of [8, 10].entries()) {
        check(surface.get_at([x, 280]).every((v, channel) => v === background[i][channel]),
          "indicator painted a background or border");
      }
      present(surface);
      return { sky, hud, targeting, labels, arrowPixels: pixels, reserved, unchangedPhysics: true };
    } finally {
      setChooseTargetPredicate(() => false);
    }
  }

  function rules(): Record<string, unknown> {
    const gs = buildState("BLACK"), renderer = makeRenderer(gs), surface = new pg.Surface([gs.w, gs.h]);
    const labels = labelsDrawnBy(renderer);
    const p = new Projectile(gs.current_shooter, ITEMS[0], 500, -100, 0, 0);
    gs.projectiles = [p];
    const render = (): number => { labels.length = 0; renderer.render(surface, gs, 0); return arrowPixels(surface); };
    check(render() > 25 && labels[0] === "100 px", "airborne missile has no marker");
    for (const kind of ["rolling", "tunneling", "penetrating", "effect", "inactive", "invisible"]) {
      p.state = { [kind]: true };
      p.mode = kind === "penetrating" ? 1 : -1;
      p.active = kind !== "inactive";
      p.weaponEffect = kind === "effect" ? { kind: "funky", trails: [], bursts: [], phase: "hold", hold: 0 } as never : undefined;
      gs.cfg.BOMB_ICON = kind === "invisible" ? "INVISIBLE" : "SMALL";
      check(render() === 0 && labels.length === 0, `${kind} projectile gained a marker`);
    }
    p.state = {}; p.mode = -1; p.active = true; p.weaponEffect = undefined; gs.cfg.BOMB_ICON = "BIG";
    check(render() > 25, "marker did not return after enabling visible icons");
    p.sy = 0;
    check(render() === 0, "re-entered missile retained its marker");
    p.sy = 20;
    check(render() === 0, "HUD-obscured missile gained a marker");
    p.sy = -100;
    const child = new Projectile(gs.current_shooter, ITEMS[0], 505, -110, 0, 0);
    gs.projectiles = [p, child];
    gs.phase = "sim_live";
    render(); check(labels.includes("2 missiles"), "split/simultaneous missiles failed to group");
    child.sx = 850;
    render(); check(labels.length === 2 && !labels.some((v) => v.includes("missiles")), "separated missiles stayed grouped");
    gs.projectiles = [];
    check(render() === 0, "removed missiles retained their markers");
    gs.projectiles = [p]; render();
    gs.start_round();
    check(render() === 0, "new round retained a marker");
    present(surface);
    return { exclusions: 6, reentry: true, removal: true, newRound: true, split: true, simultaneous: true };
  }

  function flight(stage: "above" | "return"): Record<string, unknown> {
    const gs = buildState("BLACK"), surface = new pg.Surface([gs.w, gs.h]), renderer = makeRenderer(gs);
    const labels = labelsDrawnBy(renderer);
    gs.cfg.live_elastic = 0; gs.cfg.AIR_VISCOSITY = 0; gs.cfg.GRAVITY = 0.2;
    const tank = gs.current_shooter!;
    tank.x = 512; tank.y = 499; tank.angle = 90; tank.power = 1000; tank.selected_weapon = 0;
    const [p] = gs.fire();
    check(!!p, "normal fire did not launch a missile");
    let left = false, returned = false, captured = false, steps = 0;
    let above: pg.Surface | undefined;
    let aboveLabels: string[] = [];
    for (; steps < 3000 && gs.projectiles.includes(p); steps++) {
      gs.update(C.DT);
      labels.length = 0;
      const snapshot = physicsSnapshot(gs);
      renderer.render(surface, gs, steps * C.DT * 1000);
      check(snapshot === physicsSnapshot(gs), "rendering changed the launched missile's trajectory");
      if (p.sy < 0) {
        if (!left) check(arrowPixels(surface) > 25, "launched missile disappeared without an indicator");
        left = true;
        if (p.sy < -150 && !captured) {
          above = surface.copy(); aboveLabels = [...labels]; captured = true;
        }
      } else if (left) {
        returned = true;
        check(labels.length === 0 && arrowPixels(surface) === 0, "returning missile retained an indicator");
        break;
      }
    }
    check(left && returned && captured, "normal launch did not leave and re-enter the battlefield");
    present(stage === "above" ? above! : surface);
    return { normalLaunch: true, left, returned, steps, aboveLabels, unchangedPhysics: true };
  }

  return {
    indicator_dark: () => demo("BLACK"),
    indicator_bright: () => demo("PLAIN"),
    indicator_no_hud: () => demo("BLACK", false),
    indicator_target_hud: () => demo("PLAIN", true, true),
    indicator_rules: rules,
    indicator_flight: () => flight("above"),
    indicator_return: () => flight("return"),
  };
}
