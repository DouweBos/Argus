/**
 * Client for conductor's streaming device-input WebSocket.
 *
 * One socket per device. Conductor sends a `hello` with its capabilities; we
 * reply `select` and then stream normalized (0..1) pointer/key/button/scroll/
 * remote frames. Conductor owns coord→device translation and keymaps. Fire-and-
 * forget: we don't await acks (that would serialize the stream); we drop our own
 * intermediate `move` frames when the send buffer backs up, but never drop a
 * `down`/`up`/`cancel` phase transition.
 *
 * Wire protocol mirrors conductor `packages/cli/src/daemon/input-protocol.ts`.
 */

export type LiveDragMode = "buffered" | "native" | "none";

export interface InputCapabilities {
  binaryPointer: boolean;
  buttons: string[];
  coord: "normalized";
  drag: boolean;
  keyboard: boolean;
  liveDrag: LiveDragMode;
  multitouch: boolean;
  springboard: boolean;
  text: boolean;
  touch: boolean;
  tvRemote: boolean;
}

export type PointerPhase = "cancel" | "down" | "move" | "up";

/** Minimal WebSocket surface — the browser `WebSocket` satisfies it; tests inject a fake. */
export interface WebSocketLike {
  bufferedAmount: number;
  close: () => void;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onopen: ((ev: unknown) => void) | null;
  readyState: number;
  send: (data: string) => void;
}

const OPEN = 1;
/** Above this many queued bytes we drop intermediate pointer moves (coalesce). */
const MAX_BUFFERED = 32_768;

export interface DeviceInputClientOptions {
  /** Injectable socket factory for tests; defaults to the global WebSocket. */
  createSocket?: (url: string) => WebSocketLike;
  onCapabilities?: (caps: InputCapabilities) => void;
  onClose?: () => void;
  pointerHz?: number;
}

export class DeviceInputClient {
  private ws: WebSocketLike | null = null;
  private seq = 0;
  private caps: InputCapabilities | null = null;
  private readyState = false;

  constructor(
    private readonly url: string,
    private readonly opts: DeviceInputClientOptions = {},
  ) {}

  get ready(): boolean {
    return this.readyState;
  }

  get capabilities(): InputCapabilities | null {
    return this.caps;
  }

  connect(): void {
    const make =
      this.opts.createSocket ??
      ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    const ws = make(this.url);
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onclose = () => {
      this.readyState = false;
      this.opts.onClose?.();
    };
    ws.onerror = () => {
      /* surfaced via onclose */
    };
  }

  close(): void {
    this.readyState = false;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  // ── Event senders (normalized 0..1 coords) ──────────────────────────────────

  pointer(id: number, phase: PointerPhase, x: number, y: number): void {
    // Coalesce: drop intermediate moves under backpressure; phases are lossless.
    if (phase === "move" && this.backedUp()) {
      return;
    }
    this.send({ t: "pointer", id, phase, x, y });
  }

  key(code: string, down: boolean, mods?: string[]): void {
    this.send({
      t: "key",
      code,
      down,
      ...(mods && mods.length ? { mods } : {}),
    });
  }

  text(value: string): void {
    this.send({ t: "text", value });
  }

  button(
    name: string,
    action: "down" | "press" | "up" = "press",
    holdMs = 0,
  ): void {
    this.send({ t: "button", name, action, ...(holdMs ? { holdMs } : {}) });
  }

  scroll(x: number, y: number, dx: number, dy: number): void {
    this.send({ t: "scroll", x, y, dx, dy });
  }

  tvremote(buttonName: string, holdMs = 0): void {
    this.send({
      t: "tvremote",
      button: buttonName,
      ...(holdMs ? { holdMs } : {}),
    });
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private backedUp(): boolean {
    return !this.ws || this.ws.bufferedAmount > MAX_BUFFERED;
  }

  private send(frame: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN || !this.readyState) {
      return;
    }
    try {
      ws.send(JSON.stringify({ ...frame, seq: this.seq++ }));
    } catch {
      // socket died mid-send; onclose will flip readiness
    }
  }

  private onMessage(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }
    let frame: {
      capabilities?: InputCapabilities;
      protocol?: number;
      t?: string;
    };
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (frame.t === "hello" && frame.capabilities) {
      this.caps = frame.capabilities;
      // Reply `select`, then we're ready to stream.
      this.rawSend({
        t: "select",
        protocol: frame.protocol ?? 1,
        coalesce: { pointerHz: this.opts.pointerHz ?? 120 },
      });
      this.readyState = true;
      this.opts.onCapabilities?.(frame.capabilities);
    }
    // `error` / `stat` frames are advisory; ignored here.
  }

  /** Send without the ready gate (used for the handshake reply). */
  private rawSend(frame: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) {
      return;
    }
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // ignore
    }
  }
}
