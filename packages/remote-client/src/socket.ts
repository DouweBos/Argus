/**
 * Plain WebSocket carrying raw binary Noise frames. Connects directly to the
 * desktop gateway (via the Cloudflare tunnel) — no rooms, no relay framing.
 * Same logic on native (RN global WebSocket) and web.
 */

export interface SocketHandlers {
  onOpen: () => void;
  onFrame: (bytes: Uint8Array) => void;
  onClose: () => void;
}

export class GatewaySocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoff = 1000;

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
    this.ws?.close();
    this.ws = null;
  }

  /** Bytes queued on the socket, for transfer backpressure. */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  send(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(bytes);
    }
  }

  private open(): void {
    if (this.closed) {
      return;
    }
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.handlers.onOpen();
    };
    ws.onmessage = (ev: MessageEvent) => {
      const data = ev.data as ArrayBuffer | string;
      if (data instanceof ArrayBuffer) {
        this.handlers.onFrame(new Uint8Array(data));
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.handlers.onClose();
      if (!this.closed) {
        setTimeout(() => this.open(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    };
    ws.onerror = () => ws.close();
  }
}
