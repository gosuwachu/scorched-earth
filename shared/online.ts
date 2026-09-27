/** LAN wire types. Game objects and simulation never cross this boundary. */
export interface Player {
  id: string;
  name: string;
  icon: number;
  ai: number;
  ready: boolean;
  connected: boolean;
}

export interface RoomView {
  id: string;
  started: boolean;
  hostConnected: boolean;
  players: Player[];
}

export interface Control {
  id: string;
  label: string;
  kind: "button" | "number" | "select" | "toggle" | "label";
  value?: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  disabled?: boolean;
}

export interface ControllerView {
  /** When present, limit the phone's standard buttons to these controls. */
  keys?: string[];
  targeting?: boolean;
  context: number;
  enabled: boolean;
  screen: string;
  message: string;
  round: number;
  tank?: {
    name: string; icon: number; health: number; cash: number;
    angle: number; power: number; weapon: string; ammo: number;
  };
  controls: Control[];
}

export type Input =
  | { kind: "key"; key: string; down: boolean }
  | { kind: "hold"; keys: string[] }
  | { kind: "control"; id: string; value?: number | boolean };

export type ClientMessage =
  | { type: "create" }
  | { type: "host-resume"; room: string; token: string }
  | { type: "join"; room: string; token?: string }
  | { type: "profile"; name: string; icon: number; ready: boolean }
  | { type: "add-ai"; ai: number; name: string; icon: number }
  | { type: "remove"; player: string }
  | { type: "start" }
  | { type: "end" }
  | { type: "states"; states: Record<string, ControllerView> }
  | { type: "input"; context: number; seq: number; input: Input };

export type ServerMessage =
  | { type: "created"; room: RoomView; token: string }
  | { type: "joined"; room: RoomView; player: string; token: string }
  | { type: "room"; room: RoomView }
  | { type: "started"; room: RoomView }
  | { type: "state"; state: ControllerView }
  | { type: "input"; player: string; context: number; seq: number; input: Input }
  | { type: "release"; player: string }
  | { type: "ended"; message: string }
  | { type: "replaced"; message: string }
  | { type: "error"; message: string; fatal?: boolean };

export const REMOTE_KEYS = [
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Tab",
  "BracketLeft", "Escape", "KeyI", "KeyT", "KeyF", "KeyR", "KeyP", "KeyB", "Minus",
  "Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
] as const;

export function validInput(value: unknown): value is Input {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const key = (k: unknown): boolean => typeof k === "string" && (REMOTE_KEYS as readonly string[]).includes(k);
  if (v.kind === "key") return key(v.key) && typeof v.down === "boolean";
  if (v.kind === "hold") return Array.isArray(v.keys) && v.keys.length <= REMOTE_KEYS.length && v.keys.every(key);
  return v.kind === "control" && typeof v.id === "string" && v.id.length < 100 &&
    (v.value === undefined || typeof v.value === "boolean" || (typeof v.value === "number" && Number.isFinite(v.value)));
}

export function canStart(players: Player[]): boolean {
  return players.length >= 2 && players.length <= 10 && players.some((p) => p.ai === 0) &&
    players.every((p) => p.ai !== 0 || (p.ready && p.connected));
}
