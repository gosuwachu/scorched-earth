import { randomUUID } from "node:crypto";
import type { ClientMessage, ControllerView, Player, RoomView, ServerMessage } from "../shared/online.js";
import { canStart, validInput } from "../shared/online.js";

export interface Peer {
  send(message: ServerMessage): void;
  close(): void;
}
interface Member extends Player { token: string; peer?: Peer; seq: number }
interface Room {
  id: string; token: string; host?: Peer; players: Member[]; started: boolean;
  abandoned?: number; states: Record<string, ControllerView>;
}

/** Transport-independent room registry; the host remains the game authority. */
export class Rooms {
  private rooms = new Map<string, Room>();
  private bindings = new Map<Peer, { room: Room; member?: Member }>();

  private view(r: Room): RoomView {
    return { id: r.id, started: r.started, hostConnected: !!r.host, players: r.players.map(
      ({ id, name, icon, ai, ready, connected }) => ({ id, name, icon, ai, ready, connected }),
    ) };
  }

  private broadcast(r: Room, message: ServerMessage): void {
    r.host?.send(message);
    for (const p of r.players) p.peer?.send(message);
  }

  private changed(r: Room): void { this.broadcast(r, { type: "room", room: this.view(r) }); }

  disconnect(peer: Peer, now = Date.now()): void {
    const binding = this.bindings.get(peer);
    this.bindings.delete(peer);
    if (!binding) return;
    const { room: r, member: p } = binding;
    if (p && p.peer === peer) {
      p.peer = undefined;
      p.connected = false;
      delete r.states[p.id];
      r.host?.send({ type: "release", player: p.id });
      delete r.states[p.id];
    } else if (!p && r.host === peer) {
      r.host = undefined;
      r.abandoned = now;
      r.states = {};
    }
    this.changed(r);
  }

  expire(now = Date.now()): void {
    for (const r of this.rooms.values()) {
      if (!r.host && r.abandoned !== undefined && now - r.abandoned >= 300_000) this.end(r);
    }
  }

  private end(r: Room): void {
    this.broadcast(r, { type: "ended", message: "The host ended this room. Join a new game to play again." });
    for (const [peer, b] of this.bindings) {
      if (b.room === r) { this.bindings.delete(peer); peer.close(); }
    }
    this.rooms.delete(r.id);
  }

  receive(peer: Peer, data: unknown): void {
    const fail = (message: string, fatal = false): void => peer.send({ type: "error", message, fatal });
    if (!data || typeof data !== "object") return fail("Invalid message.");
    const m = data as ClientMessage;
    const bound = this.bindings.get(peer);
    if (!bound) {
      if (m.type === "create") {
        const r: Room = { id: randomUUID(), token: randomUUID(), host: peer, players: [], started: false, states: {} };
        this.rooms.set(r.id, r);
        this.bindings.set(peer, { room: r });
        peer.send({ type: "created", room: this.view(r), token: r.token });
        return;
      }
      if (m.type !== "join" && m.type !== "host-resume") return fail("Join a room first.");
      const r = this.rooms.get(m.room);
      if (!r) return fail("This room is no longer available. Ask the host for a new link.", true);
      if (m.type === "host-resume") {
        if (m.token !== r.token) return fail("Host session no longer available.", true);
        if (r.host) { this.bindings.delete(r.host); r.host.close(); }
        r.host = peer;
        r.abandoned = undefined;
        this.bindings.set(peer, { room: r });
        peer.send({ type: "created", room: this.view(r), token: r.token });
        this.changed(r);
        return;
      }
      let p = r.players.find((p) => p.ai === 0 && p.token === m.token);
      if (!p) {
        if (m.token) return fail("Your player is no longer in this room.", true);
        if (r.started) return fail("Game already started. Rejoin using the browser you originally joined with.", true);
        if (r.players.length >= 10) return fail("This room is full.", true);
        p = { id: randomUUID(), token: randomUUID(), name: "Player", icon: 3, ai: 0, ready: false, connected: true, seq: -1 };
        r.players.push(p);
      }
      if (p.peer) {
        this.bindings.delete(p.peer);
        p.peer.send({ type: "replaced", message: "This player is now controlled by another tab." });
        p.peer.close();
      }
      r.host?.send({ type: "release", player: p.id });
      p.peer = peer;
      p.connected = true;
      p.seq = -1;
      this.bindings.set(peer, { room: r, member: p });
      peer.send({ type: "joined", room: this.view(r), player: p.id, token: p.token });
      this.changed(r);
      return;
    }

    const { room: r, member: p } = bound;
    if (p) {
      if (m.type === "profile" && !r.started) {
        if (typeof m.name !== "string" || !m.name.trim() || m.name.trim().length > 8 ||
          !Number.isInteger(m.icon) || m.icon < 0 || m.icon > 5 || typeof m.ready !== "boolean") return fail("Choose a tank and a name of 1–8 characters.");
        p.name = m.name.trim(); p.icon = m.icon; p.ready = m.ready;
        this.changed(r);
      } else if (m.type === "input" && r.started && r.host) {
        if (!validInput(m.input) || !Number.isSafeInteger(m.seq) || m.seq <= p.seq || !Number.isSafeInteger(m.context)) return;
        p.seq = m.seq;
        const state = r.states[p.id];
        if (state?.enabled && state.context === m.context) {
          r.host.send({ type: "input", player: p.id, context: m.context, seq: m.seq, input: m.input });
        }
      }
      return;
    }
    if (m.type === "end") return this.end(r);
    if (m.type === "add-ai" && !r.started) {
      if (r.players.length >= 10) return fail("This room is full.");
      if (!Number.isInteger(m.ai) || m.ai < 1 || m.ai > 8 || !Number.isInteger(m.icon) || m.icon < 0 || m.icon > 6 ||
        typeof m.name !== "string" || !m.name.trim() || m.name.trim().length > 8) return fail("Invalid computer tank.");
      r.players.push({ id: randomUUID(), token: "", name: m.name.trim(), icon: m.icon, ai: m.ai, ready: true, connected: true, seq: -1 });
      this.changed(r);
    } else if (m.type === "remove" && !r.started) {
      const removed = r.players.find((p) => p.id === m.player);
      if (removed?.peer) {
        this.bindings.delete(removed.peer);
        removed.peer.send({ type: "ended", message: "The host removed you from this lobby." });
        removed.peer.close();
      }
      r.players = r.players.filter((p) => p.id !== m.player);
      this.changed(r);
    } else if (m.type === "start" && !r.started) {
      if (!canStart(r.players)) return fail("Start needs 2–10 tanks and every human connected and ready.");
      r.started = true;
      this.broadcast(r, { type: "started", room: this.view(r) });
    } else if (m.type === "states" && r.started && m.states && typeof m.states === "object") {
      r.states = m.states;
      for (const p of r.players) if (p.peer && r.states[p.id]) p.peer.send({ type: "state", state: r.states[p.id] });
    }
  }
}
