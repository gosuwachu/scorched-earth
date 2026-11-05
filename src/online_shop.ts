import type { GameState } from "./game";
import type { Tank } from "./objects";
import { InventoryScreen, ShopScreen } from "./screens";
import { UI_ACTION, type ScreenEvent } from "./screen";

/** Host-owned shopping state. Each player has an independent screen stack. */
export class OnlineShopSession {
  readonly shop: ShopScreen;
  inventory: InventoryScreen | null = null;
  done = false;

  constructor(gs: GameState, readonly tank: Tank, private changed: () => void) {
    this.shop = new ShopScreen(gs as never, tank as never, gs.w, gs.h);
  }

  get top(): ShopScreen | InventoryScreen { return this.inventory ?? this.shop; }

  handle(event: ScreenEvent): void {
    if (!this.done) this.act(this.top.handle(event));
  }

  dispatch(action: string | null): void { this.handle({ type: UI_ACTION, action }); }

  act(action: string | null): void {
    if (this.done) return;
    if (action === "shop_inventory") {
      this.inventory = new InventoryScreen(this.shop.state, this.tank as never, this.shop.w, this.shop.h);
    } else if (action === "pop") {
      if (this.inventory) this.inventory = null;
      else this.done = true;
    } else return;
    this.changed();
  }
}

export class OnlineShopping {
  readonly sessions: OnlineShopSession[];
  selected = 0;
  private finished = false;

  constructor(gs: GameState, private changed: () => void, private complete: () => void) {
    this.sessions = gs.tanks.filter((t) => t.ai_class === 0)
      .map((tank) => new OnlineShopSession(gs, tank, () => this.update()));
  }

  get current(): OnlineShopSession { return this.sessions[this.selected]; }
  get ready(): number { return this.sessions.filter((s) => s.done).length; }

  select(index: number): void {
    if (!Number.isInteger(index) || !this.sessions[index] || this.sessions[index].done) return;
    this.selected = index;
    this.changed();
  }

  private update(): void {
    if (this.finished) return;
    if (this.sessions.every((s) => s.done)) {
      this.finished = true;
      this.complete();
      return;
    }
    if (this.current.done) this.selected = this.sessions.findIndex((s) => !s.done);
    this.changed();
  }
}
