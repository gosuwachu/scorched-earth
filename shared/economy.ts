/** Cash credited during the completed round, independent of current balance. */
export interface ShopIncome {
  resupply: number;
  combat: number;
  penalties: number;
  recovery: number;
}
