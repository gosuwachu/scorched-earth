import type { ClientMessage, ServerMessage } from "../shared/online";

/** Reconnect the transport, but never retain/replay player commands. */
export class Connection {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private delay = 300;
  connected = false;

  constructor(
    private hello: () => ClientMessage,
    private receive: (m: ServerMessage) => void,
    private status: (connected: boolean) => void,
  ) { this.connect(); }

  private connect(): void {
    const url = new URL("/online", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped) { socket.close(); return; }
      this.connected = true;
      this.delay = 300;
      this.status(true);
      this.send(this.hello());
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "ended" || message.type === "replaced" || (message.type === "error" && message.fatal)) {
        this.stopped = true;
      }
      this.receive(message);
      if (this.stopped) socket.close();
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.connected = false;
      this.status(false);
      if (!this.stopped) {
        this.timer = setTimeout(() => this.connect(), this.delay);
        this.delay = Math.min(3000, this.delay * 2);
      }
    };
  }

  send(message: ClientMessage): void {
    if (!this.stopped && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.connected = false;
  }
}
