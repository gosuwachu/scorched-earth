import * as pg from "./pygame";

export interface ChargeState {
  w: number; h: number;
  plasma_charge: { value: number; max: number } | null;
  set_plasma_charge(value: number): void;
  confirm_plasma_charge(): void;
  cancel_plasma_charge(): void;
}

export function chargeLayout(w: number, h: number) {
  const width = Math.min(300, w - 12), x = Math.floor((w - width) / 2), y = Math.floor(h / 2) - 55;
  return { x, y, width, height: 110, cells: Array.from({ length: 11 }, (_, i) =>
    new pg.Rect(x + 12 + i * 24, y + 39, 23, 22)),
  fire: new pg.Rect(x + 30, y + 74, 100, 23), cancel: new pg.Rect(x + width - 130, y + 74, 100, 23) };
}

export function handleCharge(state: ChargeState, e: { type: number; key?: number; pos?: [number, number]; button?: number }): boolean {
  const charge = state.plasma_charge;
  if (!charge) return false;
  if (e.type === pg.KEYDOWN) {
    const k = e.key!;
    if (k === pg.K_ESCAPE) state.cancel_plasma_charge();
    else if (k === pg.K_RETURN || k === pg.K_SPACE) state.confirm_plasma_charge();
    else if (k === pg.K_LEFT || k === pg.K_DOWN) state.set_plasma_charge(charge.value - 1);
    else if (k === pg.K_RIGHT || k === pg.K_UP) state.set_plasma_charge(charge.value + 1);
    else if (k >= pg.K_0 && k <= pg.K_9) state.set_plasma_charge(k - pg.K_0);
  } else if (e.type === pg.MOUSEBUTTONDOWN && e.button === 1 && e.pos) {
    const layout = chargeLayout(state.w, state.h);
    const value = layout.cells.findIndex((r) => r.collidepoint(e.pos!));
    if (value >= 0) state.set_plasma_charge(value);
    else if (layout.fire.collidepoint(e.pos)) state.confirm_plasma_charge();
    else if (layout.cancel.collidepoint(e.pos)) state.cancel_plasma_charge();
  }
  return true;
}
