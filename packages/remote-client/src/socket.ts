/**
 * Plain WebSocket carrying raw binary Noise frames. Connects directly to the
 * desktop gateway (via the Cloudflare tunnel) — no rooms, no relay framing.
 * Same logic on native (RN global WebSocket) and web.
 *
 * Reconnects on its own with exponential backoff (1 s, doubling, capped at
 * 30 s, reset on a successful open). Only the current socket drives that: a
 * stale one closing late must not tear down the connection that replaced it.
 */

export interface SocketHandlers {
  onOpen: () => void;
  onFrame: (bytes: Uint8Array) => void;
  onClose: () => void;
}

const MAX_BACKOFF_MS = 30_000;

export class GatewaySocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: SocketHandlers,
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    this.clearReconnect();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      detach(ws);
      ws.close();
      // Now rather than on the late `onclose`, which could land after a
      // replacement connection is already up and report it offline.
      this.handlers.onClose();
    }
  }

  /** Bytes queued on the socket, for transfer backpressure. */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** A socket is open, rather than dialling or waiting out a backoff. */
  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(bytes);
    }
  }

  /**
   * Give up on the current socket and dial again: it stopped answering.
   * A browser can take minutes to report a dead TCP connection closed, so
   * this doesn't wait for `onclose`.
   */
  drop(): void {
    const ws = this.ws;
    if (!ws || this.closed) {
      return;
    }
    detach(ws);
    ws.close();
    this.handleClose(ws);
  }

  /** Skip the rest of a backoff: the network or the tab just came back. */
  reconnectNow(): void {
    if (this.closed || this.ws) {
      return;
    }
    this.clearReconnect();
    this.backoff = 1000;
    this.open();
  }

  private open(): void {
    if (this.closed) {
      return;
    }
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      if (ws !== this.ws) {
        return;
      }
      this.backoff = 1000;
      this.handlers.onOpen();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (ws !== this.ws) {
        return;
      }
      const data = ev.data as ArrayBuffer | string;
      if (data instanceof ArrayBuffer) {
        this.handlers.onFrame(new Uint8Array(data));
      }
    };
    ws.onclose = () => this.handleClose(ws);
    ws.onerror = () => ws.close();
  }

  private handleClose(dead: WebSocket): void {
    if (dead !== this.ws) {
      return;
    }
    this.ws = null;
    this.handlers.onClose();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) {
      return;
    }
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** Silence a socket we've moved on from, so its late events reach nothing. */
function detach(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = () => {};
}
