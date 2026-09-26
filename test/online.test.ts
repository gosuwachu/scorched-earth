import { describe, expect, it } from "vitest";
import { Rooms, type Peer } from "../server/rooms";
import { canStart, validInput, type ControllerView, type Player, type ServerMessage } from "../shared/online";
import { RemoteHold } from "../src/remote";
import * as pg from "../src/pygame";

class Client implements Peer {
  messages: ServerMessage[] = [];
  closed = false;
  send(message: ServerMessage): void { this.messages.push(message); }
  close(): void { this.closed = true; }
  last<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> {
    return this.messages.filter((m) => m.type === type).at(-1) as Extract<ServerMessage, { type: T }>;
  }
}

function setup() {
  const rooms = new Rooms();
  const host = new Client();
  rooms.receive(host, { type: "create" });
  const created = host.last("created");
  const join = () => {
    const p = new Client();
    rooms.receive(p, { type: "join", room: created.room.id });
    return p;
  };
  return { rooms, host, created, join };
}
function ready(rooms: Rooms, player: Client, name = "Alice") {
  rooms.receive(player, { type: "profile", name, icon: 3, ready: true });
}
function state(context: number, enabled = true): ControllerView {
  return { context, enabled, screen: "battle", message: "Your turn", round: 1, controls: [] };
}

describe("LAN room lifecycle", () => {
  it("requires a human, 2–10 tanks, and every human connected and ready", () => {
    const p: Player = { id: "p", name: "P", icon: 3, ai: 0, ready: true, connected: true };
    const ai = { ...p, id: "ai", ai: 6 };
    expect(canStart([p])).toBe(false);
    expect(canStart([ai, ai])).toBe(false);
    expect(canStart([p, ai])).toBe(true);
    expect(canStart([{ ...p, ready: false }, ai])).toBe(false);
    expect(canStart([{ ...p, connected: false }, ai])).toBe(false);
    expect(canStart(Array.from({ length: 11 }, () => p))).toBe(false);
  });

  it("starts with a ready human and AI; locks the roster", () => {
    const { rooms, host, join, created } = setup();
    const p = join();
    rooms.receive(host, { type: "add-ai", ai: 6, name: "Spoiler", icon: 6 });
    rooms.receive(host, { type: "start" });
    expect(host.last("error").message).toContain("every human");
    ready(rooms, p);
    rooms.receive(host, { type: "start" });
    expect(host.last("started").room.players.map((p) => p.ai)).toEqual([0, 6]);
    expect(join().last("error").message).toContain("already started");
    rooms.receive(p, { type: "profile", name: "Changed", icon: 1, ready: false });
    const resumed = new Client();
    rooms.receive(resumed, { type: "join", room: created.room.id, token: p.last("joined").token });
    expect(resumed.last("joined").room.players[0].name).toBe("Alice");
  });

  it("restores the same player after disconnect without adding a tank", () => {
    const { rooms, host, join, created } = setup();
    const p = join(); const q = join(); ready(rooms, p); ready(rooms, q, "Bob");
    rooms.receive(host, { type: "start" });
    const identity = p.last("joined");
    rooms.receive(host, { type: "states", states: { [identity.player]: state(9) } });
    rooms.disconnect(p);
    expect(host.last("release").player).toBe(identity.player);
    expect(host.last("room").room.players[0].connected).toBe(false);
    const resumed = new Client();
    rooms.receive(resumed, { type: "join", room: created.room.id, token: identity.token });
    expect(resumed.last("joined").player).toBe(identity.player);
    expect(resumed.last("joined").room.players).toHaveLength(2);
    expect(resumed.last("state")).toBeUndefined();
    rooms.receive(host, { type: "states", states: { [identity.player]: state(10) } });
    expect(resumed.last("state").state.context).toBe(10);
  });

  it("replaces the old connection and prevents its commands and late close from affecting the new one", () => {
    const { rooms, host, join, created } = setup();
    const p = join(); const identity = p.last("joined"); const replacement = new Client();
    rooms.receive(replacement, { type: "join", room: created.room.id, token: identity.token });
    expect(p.last("replaced").message).toContain("another tab");
    expect(p.closed).toBe(true);
    rooms.disconnect(p);
    expect(host.last("room").room.players[0].connected).toBe(true);
    ready(rooms, p, "Impostor");
    expect(host.last("room").room.players[0].name).toBe("Player");
  });

  it("rejects missing rooms, unknown resume tokens, invalid profiles, and over-capacity joins", () => {
    const { rooms, host, join, created } = setup();
    const bad = new Client();
    rooms.receive(bad, { type: "join", room: "missing" });
    expect(bad.last("error").fatal).toBe(true);
    rooms.receive(bad, { type: "join", room: created.room.id, token: "unknown" });
    expect(bad.last("error").fatal).toBe(true);
    const p = join();
    rooms.receive(p, { type: "profile", name: "", icon: 3, ready: true });
    expect(p.last("error")).toBeDefined();
    rooms.receive(p, { type: "profile", name: "Alice", icon: 6, ready: true });
    expect(host.last("room").room.players[0].ready).toBe(false);
    for (let i = 0; i < 9; i++) join();
    expect(join().last("error").message).toContain("full");
  });

  it("supports host reconnection, expires abandoned rooms after five minutes, and explicitly ends rooms", () => {
    const { rooms, host, join, created } = setup();
    const p = join();
    rooms.disconnect(host, 100);
    expect(p.last("room").room.hostConnected).toBe(false);
    rooms.expire(300_099);
    expect(p.closed).toBe(false);
    const recovered = new Client();
    rooms.receive(recovered, { type: "host-resume", room: created.room.id, token: created.token });
    expect(p.last("room").room.hostConnected).toBe(true);
    rooms.receive(recovered, { type: "end" });
    expect(p.last("ended")).toBeDefined(); expect(p.closed).toBe(true);
    const another = setup(); const participant = another.join();
    another.rooms.disconnect(another.host, 0);
    another.rooms.expire(300_000);
    expect(participant.last("ended")).toBeDefined();
  });
});

describe("controller command routing", () => {
  it("only forwards current, enabled, unique inputs under the sender's own identity", () => {
    const { rooms, host, join } = setup();
    const p = join(); const q = join(); ready(rooms, p); ready(rooms, q, "Bob");
    rooms.receive(host, { type: "start" });
    const id = p.last("joined").player;
    rooms.receive(host, { type: "states", states: { [id]: state(7), [q.last("joined").player]: state(7, false) } });
    const command = { type: "input", seq: 1, context: 7, input: { kind: "key", key: "Space", down: true } };
    rooms.receive(q, command);
    rooms.receive(p, { ...command, context: 6 });
    rooms.receive(p, { ...command, seq: 2 });
    rooms.receive(p, { ...command, seq: 2 });
    expect(host.messages.filter((m) => m.type === "input")).toEqual([{ ...command, seq: 2, player: id }]);
    rooms.receive(p, { type: "end" });
    expect(host.closed).toBe(false);
  });

  it("validates the input vocabulary and never accepts non-finite values", () => {
    expect(validInput({ kind: "key", key: "F1", down: true })).toBe(false);
    expect(validInput({ kind: "hold", keys: ["ArrowLeft", "ArrowUp"] })).toBe(true);
    expect(validInput({ kind: "hold", keys: ["Unknown"] })).toBe(false);
    expect(validInput({ kind: "control", id: "power", value: Infinity })).toBe(false);
    expect(validInput({ kind: "control", id: "power", value: 50 })).toBe(true);
  });

  it("expires held keys and clears them immediately on release", () => {
    const hold = new RemoteHold();
    hold.set(["ArrowLeft", "ArrowUp"], 1000);
    expect(hold.get(1499)[pg.K_LEFT]).toBe(true);
    expect(hold.get(1500)).toEqual({});
    hold.set(["ArrowRight"], 2000);
    hold.clear();
    expect(hold.get(2001)).toEqual({});
  });
});
