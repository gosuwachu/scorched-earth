/** Tank death FIFO and the eleven-way roulette (271b:0005).
 * The live game uses staged handlers recovered directly from DOS in
 * combat_effects.ts, weapon_effects.ts and death_effects.ts. Historical
 * Python emitters remain as fallbacks for small oracle test doubles.
 *
 * Cases: 0 thud; 1–3 escalating blasts; 4 Funky Bomb; 5 four-way sparks
 * with twenty-point nearby damage; 6 Dirt Charge; 7 tall flame plumes;
 * 8 sinking/vertical dissolve (excluded in Cavern); 9 overlapping gray
 * bubbles; 10 hull-pixel dissolve. Retreat uses 3ef5:029a instead.
 * Each entry retains its shooter so collateral deaths in shared volleys
 * keep their kill credit. See oracle/COMBAT_FIDELITY.md for evidence/limits.
 */
import * as damage from "./damage";
import { eff_radius } from "./weapon_behaviors";
import type { Item } from "./weapons";

// ---------------------------------------------------------------------------
// Duck-typed structural shapes the death module reads/mutates.  These mirror
// exactly the fields scorch/death.py touches (a superset of damage.Tank that
// also carries the `color` palette index the throe/fountain emitters read, plus
// the armed-weapon fields the case-10 ammo predicate reads), so the
// differential dumper/test can drive the port with the same lightweight mocks
// the oracle builds.  (Kept as interfaces, not classes: the port is duck-typed
// like the Python.)
// ---------------------------------------------------------------------------

/** The dying tank: a damage.Tank plus the `color` index handed to the throe /
 *  fountain emitters (the roulette flash + throes render in the dying tank's
 *  own colour), and the case-10 armed-ammo predicate surface (3a16:121f reads
 *  the selected weapon's ammo; the scatter is visual, nothing is consumed).
 *  All optional with runtime guards, exactly as the Python getattr/hasattr
 *  reads. */
export interface DTank extends damage.Tank {
  color?: number;
  selected_weapon?: number;
  has_ammo?(slot: number): boolean;
}

/** One staged death entry (a death_queue element): mirrors the Python dict
 *  shape exactly.  kind "throe" = the kill roulette (stages start -> front ->
 *  body -> done, roll filled at processing time); kind "ascension" = the
 *  retreat/self-destruct sequence (stages climb -> blast -> done). */
export interface DeathEntry {
  kind: "throe" | "ascension";
  tank: DTank;
  stage: string;
  tick: number;
  roll?: number | null; // throe only; rolled when the corpse is processed
  sub?: number; // throe blast-ladder index (cases 1-3)
  radius?: number; // ascension grave-blast radius
  spawned?: boolean;
  shooter?: damage.Tank | null;
  weapon?: Item | null;
}

/** A step_queue signal: [signal, payload] (the Python tuple). */
export type DeathSignal = [string, unknown];

/** The game-state surface death threads through.  Superset of damage.State (the
 *  sequence calls damage.explode -> apply_tank_damage -> kill_tank ->
 *  on_tank_destroyed, the full damage chain).  Adds:
 *   - `w` (playfield width): read by the _debris_fountain FALLBACK clamp
 *     (death.py `min(state.w - 1, tank.x)`); `h` (playfield height): the sink
 *     case's descent floor clamp (death.py `min(state.h - 1, t.y + 1)`).
 *   - explosion_scale: the resolution scalar _blast_radius/_scaled multiply by
 *     (getattr(state, "explosion_scale", 1.0)).
 *   - rng.pick: the FUN_271b_0005 rand(11) roulette + the per-case rolls.
 *   - add_throe / add_death_fountain: the frame-driven emitters the throe /
 *     ascension-rise visuals register into (game.ts add_throe / add_death_fountain).
 *   - death_queue / throe_fx / death_fountains / projectiles: the staged FIFO
 *     and the emitter lists step_queue observes (all optional: a bare stub
 *     without the queue gets the immediate fallback in death_sequence, exactly
 *     as a stub without add_death_fountain gets the one-puff fallback).  (cfg
 *     is inherited from damage.State; SUSPEND_DIRT / ICON_BAR are read
 *     defensively at runtime like the Python's getattr, because dump-driven
 *     stubs may omit them.) */
export interface DState extends damage.State {
  combat_blast?: (x: number, y: number, radius: number) => void;
  combat_throe?: (kind: string, x: number, y: number, tank?: DTank) => void;
  tanks: DTank[];
  w: number;
  h: number;
  explosion_scale?: number;
  rng: { pick(n: number): number };
  // add_explosion is inherited from damage.State (cx,cy,radius); the death
  // module additionally passes the dirt_only keyword on the fallback path, so
  // widen the signature here to accept it (a superset; damage.State's call sites
  // pass no kwargs, which remains valid).
  add_explosion(cx: number, cy: number, radius: number, kw?: { [k: string]: unknown }): void;
  /** `life` overrides the game-side THROE_LIFE (case 4's rand(6)+5 steps). */
  add_throe(kind: string, x: number, y: number, color: number, life?: number | null): void;
  add_death_fountain?: (
    x: number,
    y: number,
    top: number,
    kw?: { color?: number; stride?: number; scatter?: number }
  ) => void;
  /** FIFO of staged deaths; game.ts owns the array, step_queue drives it. */
  death_queue?: DeathEntry[];
  /** Read by step_queue to observe stage retirement (game.ts owns/steps them). */
  throe_fx?: unknown[];
  death_fountains?: unknown[];
  /** A live flight (the killing shot mid-air) blocks the queue. */
  projectiles?: unknown[];
}

// --------------------------------------------------------------------------- //
// Tunables and byte-pinned constants.
// --------------------------------------------------------------------------- //

// 271b:03b5 (file 0x1df65): 40 loop iterations of flash + rising tone (FACT).
export const THROE_FRONT_TICKS = 40;
// Case 2/3 inter-blast delay(0x64): the front helper spends one 9af6(5) delay
// unit per tick, so 0x64 units ~= 20 ticks (RECONSTRUCTED time mapping).
export const THROE_DELAY_TICKS = 20;

// The escalation radii DAT_5f38_1242 < _1276 < _12aa ("small / large / cap").
// These are effective-radius fields in the weapon table, initialized at
// 33a1:1061 from Missile 20, Baby Nuke 40 and Nuke 75. They are recoverable.
export const RADIUS_SMALL = 20; // DAT_5f38_1242 analogue
export const RADIUS_LARGE = 40; // DAT_5f38_1276 analogue
export const RADIUS_CAP = 75; // DAT_5f38_12aa analogue

// Case 10 hull-debris scatter: fragment count/kinematics live in game.add_throe
// ("debris" kind), RECONSTRUCTED (the scatter routine 37d2:0392 is FP-mangled;
// the stroke-buffer source 49d4:0177 is byte-identified).

// Case 8 sink depth: FUN_352c_00c9 sinks to a random depth bounded by the floor
// global [0xef38].  Port draw: random 8..31 px, floor-clamped (RECONSTRUCTED
// range; the loop shape and the falling tones are FACT).
export const SINK_DEPTH_MIN = 8;
export const SINK_DEPTH_RAND = 24;

// Case 4 expanding ball: entry decodes rand(6)+5 expansion steps (FACT) with a
// blue-white DAC swatch 556b:0005(0xfe, 0x1e,0x1e,0x3f); segment 2dce
// UNDECOMPILED, so the ball is a reconstructed expanding disc.  Life per step
// is the port's frame quantum for throes (game.THROE_LIFE handles the total).
export const BALL_STEP_FRAMES = 6;

// --- the ascension sequence's debris climb (unchanged geometry) --- //

// FUN_3ef5_067b/_06d4 stamp a 5(w) x 6(h) byte grid (0x60c3); columns iVar1 in
// [-2,4), rows iVar2 in [0,5).  The fountain marches UP one row per step from the
// tank to the top clip (FUN_3ef5_029a.c:61).
export const DEBRIS_PUFF_RADIUS = 2; // 5x6 sprite ~ a 2px puff in the port's space
export const DEBRIS_ROW_STRIDE = 6; // sample the rising column every ~sprite-height rows
export const DEBRIS_TOP_MARGIN = 7; // :61 stops at DAT_5f38_ef40 - 7 (top clip - 7)

// FUN_4d1e_015a(:96) is called with DAT_5f38_120e = the CURRENT weapon's
// effective radius word.  For a retreat there is no detonating weapon, so the
// fallback radius applies.
export const DEATH_BLAST_FALLBACK = 18; // px (the port's long-standing fallback crater)

export const PLAYFIELD_TOP = 2;
// ef40 is the top of the PLAYFIELD: the binary's climb never enters the status
// area above it.  The port composites the ~Icon Bar OVER the field instead of
// insetting the field (render draws the bar AFTER the death tiles), so with the
// bar on, the faithful ceiling analogue is the bar's bottom edge -- otherwise the
// figure's cap climbs under the bar and is dimmed to ~25% brightness (reported:
// "the UFO is missing its top pixels").  == render BAR_H; duplicated so death.ts
// stays renderer-free.
export const STATUS_BAR_H = 22;

/**
 * The ascension grave-crater radius (FUN_3ef5_029a.c:96, DAT_5f38_120e == the
 * current weapon's effective radius; retreat has no weapon -> fallback).
 */
export function _blast_radius(state: DState, weapon: Item | null = null): number {
  if (weapon !== null) {
    // weapon_behaviors.eff_radius(state, weapon) == abs(weapon.blast) * scale.
    // eff_radius reads state.explosion_scale; DState carries it (optional, but a
    // weapon kill always comes from a real GameState which sets it).  The cast
    // narrows DState to the eff_radius parameter shape (it only reads
    // explosion_scale + weapon.blast).
    const r = eff_radius(
      state as unknown as Parameters<typeof eff_radius>[0],
      weapon
    );
    if (r && r > 0) {
      return Math.trunc(r);
    }
  }
  // int(DEATH_BLAST_FALLBACK * getattr(state, "explosion_scale", 1.0))
  const scale = state.explosion_scale ?? 1.0;
  return Math.trunc(DEATH_BLAST_FALLBACK * scale);
}

/**
 * Escalation radii are mode-derived in the binary; the port scales its
 * reconstructed class radii by the same explosion_scale every blast uses.
 */
export function _scaled(state: DState, r: number): number {
  return Math.max(1, Math.trunc(r * (state.explosion_scale ?? 1.0)));
}

/**
 * Port of FUN_3ef5_029a.c:60-77 -- the RISING ascension tile (see the module
 * header; geometry unchanged from the byte decode of 0x60c3).
 */
export function _debris_fountain(state: DState, tank: DTank, scatter = false): void {
  // getattr(state, "cfg", None) mirror: dump-driven stubs may omit cfg entirely.
  const cfgLike = (state as { cfg?: { is_on(key: string): boolean } }).cfg;
  const iconBar = cfgLike !== undefined && cfgLike.is_on("ICON_BAR");
  const fieldTop = iconBar ? STATUS_BAR_H : PLAYFIELD_TOP;
  const top = Math.max(PLAYFIELD_TOP, fieldTop) + DEBRIS_TOP_MARGIN; // ef40-7 analogue
  if (state.add_death_fountain === undefined) {
    // defensive fallback (a GameState stub without the emitter): stamp once at
    // the tank so a debris puff still appears, never the full-height streak.
    state.add_explosion(
      Math.max(0, Math.min(state.w - 1, tank.x)),
      tank.y,
      DEBRIS_PUFF_RADIUS,
      { dirt_only: true }
    );
    return;
  }
  state.add_death_fountain(tank.x, tank.y, top, {
    color: tank.color ?? 15,
    stride: DEBRIS_ROW_STRIDE,
    scatter: scatter ? 3 : 1,
  });
}

/**
 * FUN_3ef5_029a.c:96 -- the standard explosion FUN_4d1e_015a at the tank
 * center with param_4=1 (carve + radial damage + settle).
 */
export function _ascension_blast(state: DState, tank: DTank, radius: number): void {
  if (state.combat_blast) state.combat_blast(tank.x, tank.y, radius);
  else damage.explode(state, tank.x, tank.y, radius, true);
}

// --------------------------------------------------------------------------- //
// Queue entries.
// --------------------------------------------------------------------------- //

/**
 * A tank's health reached <= 0: register it for the KILL ROULETTE.
 *
 * The binary's dead-tank sweep (FUN_2a4a_23f8) processes corpses at the next
 * settle point; the port's equivalent is enqueueing here (from damage.kill_tank
 * -> on_tank_destroyed) and processing in step_queue.  The award, taunt, roll
 * and FX all happen at PROCESSING time, the binary's order -- see step_queue.
 *
 * `weapon` (the killing weapon) is accepted for call-site compatibility but the
 * roulette does not use it: the killing shot's own explosion already happened,
 * and the throe REPLACES the old uniform "grave blast".
 *
 * Stub fallback (no state.death_queue): run the roll + case body immediately,
 * FX only (no award/taunt -- scoring stays with the caller's own model).
 * Returns the roll for the immediate path, else null (the roll now happens at
 * processing time).
 */
export function death_sequence(
  state: DState,
  tank: DTank,
  _weapon: Item | null = null
): number | null {
  const q = state.death_queue;
  if (q === undefined) {
    const roll = _roll_throe(state);
    _case_body_immediate(state, tank, roll);
    return roll;
  }
  q.push({ kind: "throe", tank, stage: "start", roll: null, tick: 0, sub: 0, shooter: state.current_shooter, weapon: _weapon });
  return null;
}

/**
 * The 'r'-key retreat / self-destruct path: FUN_3ef5_029a.  Tones + the rising
 * 0x60c3 figure + the weapon-radius grave blast, THEN the sweep (the blast's
 * collateral kills get roulette throes via the normal kill chain).  The
 * ascending tank gets NO kill award and NO throe (its in-play flag is cleared
 * at 029a:53, before the sweep at :98).
 */
export function retreat_sequence(state: DState, tank: DTank, weapon: Item | null = null): void {
  const q = state.death_queue;
  const radius = _blast_radius(state, weapon);
  if (q === undefined) {
    _debris_fountain(state, tank, false);
    _ascension_blast(state, tank, radius);
    return;
  }
  q.push({ kind: "ascension", tank, stage: "climb", radius, tick: 0, spawned: false });
}

/** 271b:00f4: the sink effect is excluded in Cavern (DS:50d8). */
export function _roll_throe(state: DState): number {
  const suspend = (state as DState & { live_sky?: string }).live_sky === "CAVERN";
  let roll = state.rng.pick(11);
  while (suspend && roll === 8) {
    roll = state.rng.pick(11);
  }
  return roll;
}

// --------------------------------------------------------------------------- //
// The queue stepper.
// --------------------------------------------------------------------------- //

/**
 * Advance the staged death FIFO one effect tick; returns [signal, payload]
 * tuples for the caller's sound/palette side-effects:
 *
 *   ["award", tank]      kill award + die taunt due (processing time)
 *   ["front", color]     40-tick flash + rising-tone lead-in starts (cases 0-5)
 *   ["thud", null]       case 0's 100 Hz thud
 *   ["blast", radius]    one escalation blast fired (cases 1-3)
 *   ["sink", null]       case 8 began sinking (falling tones)
 *   ["cookoff", null]    case 10's wreck burst (hull-debris scatter)
 *   ["climb", null]      ascension tones + figure rise began
 *
 * ONE entry plays at a time (binary: blocking, nested).  A live projectile
 * (the killing shot still in flight when a settle-path kill enqueued) blocks
 * the queue -- the binary resolves flights before the sweep continues.
 */
export function step_queue(state: DState): DeathSignal[] {
  const signals: DeathSignal[] = [];
  const q = state.death_queue;
  if (q === undefined || q.length === 0) {
    return signals;
  }
  let guard = 0;
  while (q.length > 0 && guard < 64) {
    guard += 1;
    if (state.projectiles !== undefined && state.projectiles.length > 0) {
      break; // a flight owns the screen first
    }
    const e = q[0];
    const previousShooter = state.current_shooter, previousWeapon = state.current_weapon;
    try {
      if (e.shooter !== undefined) state.current_shooter = e.shooter;
      if (e.weapon !== undefined) state.current_weapon = e.weapon;
      if (e.kind === "ascension") {
        if (!_step_ascension(state, e, signals)) break;
      } else if (!_step_throe(state, e, signals)) break;
    } finally {
      state.current_shooter = previousShooter; state.current_weapon = previousWeapon;
    }
    if (q.length > 0 && q[0] === e && e.stage === "done") {
      q.shift();
    }
  }
  return signals;
}

/**
 * FUN_3ef5_029a: tones + climb (:54-77), then the grave blast (:96).
 * Returns true when the entry finished a stage transition this tick (the
 * caller may continue), false to wait.
 */
export function _step_ascension(state: DState, e: DeathEntry, signals: DeathSignal[]): boolean {
  if (e.stage === "climb") {
    if (!e.spawned) {
      e.spawned = true;
      _debris_fountain(state, e.tank, false);
      signals.push(["climb", null]);
    }
    if (state.death_fountains !== undefined && state.death_fountains.length > 0) {
      return false; // the 0x60c3 figure still rising
    }
    e.stage = "blast";
  }
  if (e.stage === "blast") {
    _ascension_blast(state, e.tank, e.radius as number);
    e.stage = "done";
  }
  return true;
}

/**
 * FUN_271b_0005 for one corpse: award/taunt, roll, cases.  Returns true to
 * continue the queue this tick, false to wait.
 */
export function _step_throe(state: DState, e: DeathEntry, signals: DeathSignal[]): boolean {
  const t = e.tank;
  if (e.stage === "start") {
    signals.push(["award", t]); // 2.1: award + taunt at processing
    e.roll = _roll_throe(state);
    if (e.roll <= 5) {
      e.stage = "front"; // 2.3: cases 0-5 get the lead-in
      e.tick = 0;
      signals.push(["front", t.color ?? 15]);
      return false;
    }
    e.stage = "body";
  }
  if (e.stage === "front") {
    e.tick += 1;
    if (e.tick < THROE_FRONT_TICKS) {
      return false;
    }
    e.stage = "body";
    e.tick = 0;
  }
  if (e.stage === "body") {
    return _case_body_staged(state, e, signals);
  }
  return true;
}

/**
 * Dispatch e.roll (0..10; 11 is the dead table slot).  Sub-staged where the
 * binary delays or animates.  Returns true when the entry reached "done" (or a
 * same-tick continuation is fine), false to wait a tick.
 */
export function _case_body_staged(state: DState, e: DeathEntry, signals: DeathSignal[]): boolean {
  const t = e.tank;
  const roll = e.roll as number;
  if (roll === 0) {
    // flash + thud, NO blast (case 0, file 0x1dcce)
    signals.push(["thud", null]);
    e.stage = "done";
    return true;
  }
  if (roll === 1 || roll === 2 || roll === 3) {
    // escalating standard blasts, small -> large -> cap, delay between
    // (cases 1/2/3, files 0x1dcf5/0x1dd0a/0x1dd37)
    const ladder = [RADIUS_SMALL, RADIUS_LARGE, RADIUS_CAP].slice(0, roll);
    if (e.tick > 0) {
      // in a between-blast delay
      e.tick -= 1;
      return false;
    }
    const r = _scaled(state, ladder[e.sub as number]);
    if (state.combat_blast) state.combat_blast(t.x, t.y, r);
    else damage.explode(state, t.x, t.y, r, true);
    signals.push(["blast", r]);
    e.sub = (e.sub as number) + 1;
    if ((e.sub as number) >= ladder.length) {
      e.stage = "done";
      return true;
    }
    e.tick = THROE_DELAY_TICKS; // delay(0x64) analogue
    return false;
  }
  if (roll === 4) {
    // 2dce:0000: the actual Funky Bomb handler.
    if (!e.spawned) {
      e.spawned = true;
      if (state.combat_throe) state.combat_throe("funky", t.x, t.y);
      else {
        const steps = state.rng.pick(6) + 5;
        state.add_throe("ball", t.x, t.y, t.color ?? 15, steps * BALL_STEP_FRAMES);
      }
      return false;
    }
    if (state.throe_fx !== undefined && state.throe_fx.length > 0) {
      return false;
    }
    e.stage = "done";
    return true;
  }
  if (roll === 5) {
    // 271b:0543: reflected spark rays; twenty-point damage at 06e1.
    if (!e.spawned) {
      e.spawned = true;
      if (state.combat_throe) state.combat_throe("spiral", t.x, t.y);
      else state.add_throe("spiral", t.x, t.y, t.color ?? 15);
      return false;
    }
    if (state.throe_fx !== undefined && state.throe_fx.length > 0) {
      return false;
    }
    e.stage = "done";
    return true;
  }
  if (roll === 6) {
    // 25a0:0081: Dirt Charge, including its terrain deposition.
    if (!e.spawned) {
      e.spawned = true;
      if (state.combat_throe) state.combat_throe("spray", t.x, t.y);
      else state.add_throe("sparkle", t.x, t.y, t.color ?? 15);
      return false;
    }
    if (state.throe_fx !== undefined && state.throe_fx.length > 0) {
      return false;
    }
    e.stage = "done";
    return true;
  }
  if (roll === 7) {
    // 2d4f:0258: six tall flame plumes.
    if (!e.spawned) {
      e.spawned = true;
      if (state.combat_throe) state.combat_throe("flames", t.x, t.y);
      else state.add_throe("fireworks", t.x, t.y, t.color ?? 15);
      return false;
    }
    if (state.throe_fx !== undefined && state.throe_fx.length > 0) {
      return false;
    }
    e.stage = "done";
    return true;
  }
  if (roll === 8) {
    // SINK into the ground (352c:00c9): y += 1 per step to a random depth,
    // falling tones.  The binary redraws the tank sprite each step; the port
    // draws the sink collapse throe at the descending position (RECONSTRUCTED
    // visual -- the port does not draw dead tank sprites).
    if (!e.spawned) {
      e.spawned = true;
      if (state.combat_throe) {
        state.combat_throe("sink", t.x, t.y, t);
        e.stage = "done";
        return true;
      }
      e.tick = SINK_DEPTH_MIN + state.rng.pick(SINK_DEPTH_RAND);
      state.add_throe("sink", t.x, t.y, t.color ?? 15);
      signals.push(["sink", null]);
      return false;
    }
    if (e.tick > 0) {
      e.tick -= 1;
      t.y = Math.min(state.h - 1, t.y + 1); // the corpse descends
      return false;
    }
    if (state.throe_fx !== undefined && state.throe_fx.length > 0) {
      return false;
    }
    e.stage = "done";
    return true;
  }
  if (roll === 9) {
    // 4451:016f: overlapping gray bubbles, followed by terrain cleanup.
    if (!e.spawned) {
      e.spawned = true;
      if (state.combat_throe) state.combat_throe("ring", t.x, t.y);
      else state.add_throe("ring", t.x, t.y, t.color ?? 15);
      return false;
    }
    if (state.throe_fx !== undefined && state.throe_fx.length > 0) {
      return false;
    }
    e.stage = "done";
    return true;
  }
  if (roll === 10) {
    // ammo cook-off (3a16:121f armed-ammo predicate; 271b:081b builds the
    // tank's stroke-table vertex buffer via 49d4:0177 and feeds the
    // ballistic-scatter routine 37d2:0392): the wreck's HULL PIECES scatter.
    // Visual only -- no projectile spawn, no ammo consume (byte-verified;
    // no roulette case stores into the projectile array).
    if (!e.spawned) {
      e.spawned = true;
      if (typeof t.has_ammo === "function" && t.has_ammo(t.selected_weapon ?? 0)) {
        if (state.combat_throe) state.combat_throe("debris", t.x, t.y, t);
        else state.add_throe("debris", t.x, t.y, t.color ?? 15);
        signals.push(["cookoff", null]);
      } else {
        e.stage = "done";
        return true;
      }
      return false;
    }
    if (state.throe_fx !== undefined && state.throe_fx.length > 0) {
      return false;
    }
    e.stage = "done";
    return true;
  }
  // roll 11: the dead table slot (rand max is 10) -- and any out-of-range
  // defensive value: nothing.
  e.stage = "done";
  return true;
}

/**
 * Stub fallback (no death_queue): the case FX in one tick, no staging, no
 * award/taunt.  Keeps bare test doubles (dump mocks) working.
 */
export function _case_body_immediate(state: DState, tank: DTank, roll: number): void {
  if (roll === 1 || roll === 2 || roll === 3) {
    for (const r of [RADIUS_SMALL, RADIUS_LARGE, RADIUS_CAP].slice(0, roll)) {
      damage.explode(state, tank.x, tank.y, _scaled(state, r), true);
    }
  } else if (roll === 4) {
    state.add_throe(
      "ball",
      tank.x,
      tank.y,
      tank.color ?? 15,
      (state.rng.pick(6) + 5) * BALL_STEP_FRAMES
    );
  } else if (roll === 5) {
    state.add_throe("spiral", tank.x, tank.y, tank.color ?? 15);
  } else if (roll === 6) {
    state.add_throe("sparkle", tank.x, tank.y, tank.color ?? 15);
  } else if (roll === 7) {
    state.add_throe("fireworks", tank.x, tank.y, tank.color ?? 15);
  } else if (roll === 8) {
    state.add_throe("sink", tank.x, tank.y, tank.color ?? 15);
  } else if (roll === 9) {
    state.add_throe("ring", tank.x, tank.y, tank.color ?? 15);
  } else if (roll === 10) {
    if (typeof tank.has_ammo === "function" && tank.has_ammo(tank.selected_weapon ?? 0)) {
      state.add_throe("debris", tank.x, tank.y, tank.color ?? 15);
    }
  }
  // 0 (thud) and 11: no FX here.
}
