// palette-ish UI colors (Borland-dialog gray look)
// Dialog/shop DESKTOP clear color.  The real Scorch dialog desktop is GREY, not
// the dark blue this was (the user reported the shop/dialog backdrop blue from the
// real game).  RGB is byte-recovered: the engine's general-purpose UI grey is DAC
// idx 0x96 = (0x32,0x32,0x32) 6-bit -> (200,200,200) 8-bit, written at boot in
// FUN_33a1_001d.c:118 `FUN_556b_0005(0x96,0x32,0x32,0x32)`.  RECONSTRUCTED: that
// 0x96 is specifically the dialog-DESKTOP index is not provable from the available
// decompiles (the 4f19 framework's full-screen clear is in FUN_400b_08ba, which
// disassembles to bad-instruction garbage); the desktop-clear index is BLOCKED.
// A faithful DOS grey from this binary is used, distinct from the (170,170,170)
// panel so the panel reads against it.
export const C_BG: [number, number, number] = [200, 200, 200];
export const C_PANEL: [number, number, number] = [170, 170, 170];
export const C_PANEL_HI: [number, number, number] = [210, 210, 210];
export const C_PANEL_LO: [number, number, number] = [110, 110, 110];
export const C_TEXT: [number, number, number] = [0, 0, 0];
export const C_TEXT_LT: [number, number, number] = [255, 255, 255];
// Accelerator hot-letter color.  RE (FACT): the real game draws the `~`-marked
// letter in the dotext SECONDARY color DAT_5f38_f2d8, set once at boot to palette
// index 0xa1 (FUN_33a1_001d.c:121 `FUN_5589_0679(0xa1)`).  DAC index 0xa1 is
// written 6-bit (10,63,63) at FUN_33a1_001d.c:120 -> 8-bit (40,252,252), bright
// cyan.  (Was (200,0,0) red, which the binary never uses for accelerators.)
export const C_ACCEL: [number, number, number] = [40, 252, 252];
export const C_SEL: [number, number, number] = [0, 0, 160];
export const C_BTN: [number, number, number] = [0, 0, 150];
export const C_FIELD: [number, number, number] = [255, 255, 255];

