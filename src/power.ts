/** Health-based firing limit: DOS UI caller 38b5:107d, documented in
 * oracle/GUIDANCE_FIDELITY.md. Health is stored as integer energy, 0..100. */
export function maxPower(health: number): number {
  return Math.max(0, Math.min(1000, Math.trunc(health * 10)));
}

export function clampPower(health: number, power: number): number {
  return Math.max(0, Math.min(maxPower(health), Math.trunc(power)));
}
