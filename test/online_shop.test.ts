import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Font } from "../src/pygame";
import { Config } from "../src/config";
import { createGameState } from "../src/game";
import { OnlineShopping } from "../src/online_shop";
import { RemoteAdapter } from "../src/remote";
import type { App } from "../src/main";
import type { Player } from "../shared/online";

// Only canvas text measurement is stubbed; screens and purchases run normally.
beforeEach(() => { vi.spyOn(Font.prototype, "size").mockImplementation((text) => [text.length * 8, 16]); });
afterEach(() => vi.restoreAllMocks());

function setup(mode: string) {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: mode, INITIAL_CASH: 100000, SOUND: "OFF" });
  const gs = createGameState(cfg, 640, 480, 17);
  const roster: Player[] = ["Alice", "Bob", "CPU"].map((name, i) => ({
    id: name, name, ai: i === 2 ? 1 : 0, icon: 3, colorIndex: i, ready: true, connected: true,
  }));
  for (const p of roster) gs.add_player(p.name, p.ai, 0, p.icon);
  gs.new_game();
  const complete = vi.fn();
  const shopping = new OnlineShopping(gs, () => {}, complete);
  const app = { gs, onlineShopping: shopping, onlineMenuOpen: false, transitioning: false,
    get top() { return shopping.current.top; }, onlineScreen: "player" };
  const adapter = new RemoteAdapter(app as unknown as App, roster);
  const states = () => adapter.states(roster);
  let seq = 0;
  const send = (player: string, id: string, value?: number) => {
    adapter.receive(player, states()[player].context, ++seq, { kind: "control", id, value });
  };
  return { gs, roster, shopping, app, adapter, states, send, complete };
}

describe.each(["SEQUENTIAL", "SIMULTANEOUS"])("online shopping in %s", (mode) => {
  it("accepts interleaved purchases and keeps categories and inventory independent", () => {
    const { gs, shopping, states, send } = setup(mode);
    expect(states().Alice.enabled && states().Bob.enabled).toBe(true);
    const before = gs.tanks.map((t) => ({ cash: t.cash, ammo: t.inventory[1] }));
    const context = states().Bob.context;
    send("Alice", "buy-1"); send("Bob", "buy-1"); send("Alice", "buy-1");
    for (const [i, count] of [2, 1].entries()) {
      expect(gs.tanks[i].cash).toBe(before[i].cash - count * gs.economy.price[1]);
      expect(gs.tanks[i].inventory[1]).toBe(before[i].ammo + count * 5);
    }
    expect(gs.economy.demand_tally[1]).toBe(3);
    send("Alice", "category", 1); send("Alice", "inventory");
    expect(shopping.sessions[0].inventory).not.toBeNull();
    expect(shopping.sessions[1].inventory).toBeNull();
    expect(shopping.sessions[1].shop.category).toBe(0);
    expect(states().Bob.context).toBe(context);
    send("Bob", "buy-1");
    expect(gs.tanks[1].inventory[1]).toBe(before[1].ammo + 10);
  });

  it("rejects duplicate, stale, unavailable and unaffordable purchases", () => {
    const { gs, adapter, states, send } = setup(mode);
    const context = states().Alice.context;
    const purchase = { kind: "control" as const, id: "buy-1" };
    adapter.receive("Alice", context, 10, purchase);
    const cash = gs.tanks[0].cash;
    adapter.receive("Alice", context, 10, purchase);
    adapter.receive("Bob", context, 11, purchase);
    expect(gs.tanks[0].cash).toBe(cash);
    send("Bob", "inventory");
    adapter.receive("Bob", context, 12, purchase);
    expect(gs.tanks[1].inventory[1]).toBe(0);
    gs.tanks[0].cash = 0;
    adapter.receive("Alice", context, 11, purchase);
    expect(gs.tanks[0].cash).toBe(0);
    adapter.receive("Alice", context, 12, { kind: "control", id: "buy-999" });
  });

  it("invalidates a replaced connection without disturbing another shopper", () => {
    const { gs, adapter, states } = setup(mode);
    const before = states();
    adapter.release("Alice");
    const after = states();
    expect(after.Alice.context).not.toBe(before.Alice.context);
    expect(after.Bob.context).toBe(before.Bob.context);
    const cash = gs.tanks[0].cash;
    adapter.receive("Alice", before.Alice.context, 100, { kind: "control", id: "buy-1" });
    expect(gs.tanks[0].cash).toBe(cash);
  });

  it("starts fresh sessions next round and rejects previous-round inputs", () => {
    const { gs, app, adapter, states, send } = setup(mode);
    const before = states();
    send("Bob", "category", 1);
    send("Bob", "done");
    app.onlineShopping = new OnlineShopping(gs, () => {}, () => {});
    const after = states();
    expect(after.Alice.context).not.toBe(before.Alice.context);
    expect(after.Bob.enabled).toBe(true);
    expect(app.onlineShopping.sessions[1].shop.category).toBe(0);
    const cash = gs.tanks[0].cash;
    adapter.receive("Alice", before.Alice.context, 100, { kind: "control", id: "buy-1" });
    expect(gs.tanks[0].cash).toBe(cash);
  });

  it("waits for every human and completes exactly once", () => {
    const { shopping, states, send, complete } = setup(mode);
    send("Bob", "done");
    expect(states().Bob.enabled).toBe(false);
    expect(states().Bob.message).toContain("1/2 ready");
    expect(complete).not.toHaveBeenCalled();
    send("Bob", "buy-1"); send("Bob", "done");
    send("Alice", "done");
    expect(complete).toHaveBeenCalledTimes(1);
    shopping.sessions[0].act("pop");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("preserves purchases through disconnect and pauses all sessions for the host menu", () => {
    const { gs, roster, adapter, states, send, app } = setup(mode);
    send("Alice", "buy-1");
    const cash = gs.tanks[0].cash;
    const before = states().Alice.context;
    roster[0].connected = false; adapter.release("Alice");
    expect(states().Alice.enabled).toBe(false);
    expect(states().Bob.enabled).toBe(true);
    send("Bob", "buy-1");
    roster[0].connected = true;
    expect(states().Alice.enabled).toBe(true);
    expect(states().Alice.context).not.toBe(before);
    expect(gs.tanks[0].cash).toBe(cash);
    app.onlineMenuOpen = true;
    expect(states().Alice.enabled || states().Bob.enabled).toBe(false);
    send("Bob", "done");
    app.onlineMenuOpen = false;
    expect(states().Bob.enabled).toBe(true);
  });
});

it("runs AI purchases and begins the round once after the final human finishes", async () => {
  const { App } = await import("../src/main");
  const { gs } = setup("SEQUENTIAL");
  const ai = vi.spyOn(gs, "run_ai_buys").mockImplementation(() => {});
  const begin = vi.spyOn(gs, "begin_next_round").mockImplementation(() => {});
  const app = Object.assign(Object.create(App.prototype) as App, { gs, cfg: gs.cfg, online: {}, stack: [{}] });
  app["_enter_shop"]();
  const shopping = app.onlineShopping!;
  shopping.sessions[1].dispatch("pop");
  expect(ai).not.toHaveBeenCalled();
  app.dispatchAction("pop");
  expect(app.onlineShopping).toBeNull();
  expect(ai).toHaveBeenCalledTimes(1);
  expect(begin).toHaveBeenCalledTimes(1);
  expect(ai.mock.invocationCallOrder[0]).toBeLessThan(begin.mock.invocationCallOrder[0]);
  shopping.sessions[0].dispatch("pop");
  expect(begin).toHaveBeenCalledTimes(1);
});
