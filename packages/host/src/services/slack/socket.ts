/**
 * Slack Socket Mode: an outbound websocket opened with the app-level token,
 * so Slack reaches a host behind NAT with no open port and no relay. Every
 * envelope is acked at once; Slack retries one that isn't.
 */

import type { SlackConnectionState } from "@argus/remote-protocol";
import { SlackApiError } from "./api";

export interface SocketLike {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface SocketEnvelope {
  type: string;
  envelope_id?: string;
  payload?: unknown;
  retry_attempt?: number;
}

export interface SocketModeOptions {
  /** `apps.connections.open`, with the app-level token. */
  openConnection: () => Promise<string>;
  createSocket?: SocketFactory;
  onEnvelope: (envelope: SocketEnvelope) => void;
  onState: (state: SlackConnectionState, error: string | null) => void;
  /** Injected in tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const MAX_BACKOFF_MS = 60_000;

export class SocketModeClient {
  private socket: SocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private timer: unknown = null;
  private readonly createSocket: SocketFactory;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: SocketModeOptions) {
    this.createSocket =
      options.createSocket ??
      ((url) => new WebSocket(url) as unknown as SocketLike);
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ??
      ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.attempt = 0;
    this.connect().catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.drop();
    this.options.onState("off", null);
  }

  private drop(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.options.onState("connecting", null);
    let url: string;
    try {
      url = await this.options.openConnection();
    } catch (e) {
      if (e instanceof SlackApiError && e.isAuth) {
        // Retrying a revoked token only gets rate limited.
        this.stopped = true;
        this.options.onState(
          "error",
          "Slack rejected the app-level token. Connect again with a new one.",
        );

        return;
      }
      this.retry(e instanceof Error ? e.message : String(e));

      return;
    }
    if (this.stopped) {
      return;
    }
    this.drop();
    const socket = this.createSocket(url);
    this.socket = socket;
    socket.onmessage = (event) => this.receive(socket, event.data);
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
        this.retry("The connection to Slack closed.");
      }
    };
    socket.onerror = () => undefined;
  }

  private retry(reason: string): void {
    if (this.stopped) {
      return;
    }
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt++;
    this.options.onState(this.attempt > 3 ? "error" : "connecting", reason);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.connect().catch(() => undefined);
    }, delay);
  }

  private receive(socket: SocketLike, data: unknown): void {
    let envelope: SocketEnvelope;
    try {
      envelope = JSON.parse(String(data)) as SocketEnvelope;
    } catch {
      return;
    }
    if (envelope.envelope_id) {
      socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }
    switch (envelope.type) {
      case "hello":
        this.attempt = 0;
        this.options.onState("connected", null);

        return;
      case "disconnect":
        // Slack rotates connections; open the next one before this closes.
        if (this.socket === socket) {
          this.socket = null;
          socket.onclose = null;
          this.connect()
            .catch(() => undefined)
            .finally(() => {
              try {
                socket.close();
              } catch {
                // Already closed.
              }
            });
        }

        return;
      default:
        this.options.onEnvelope(envelope);
    }
  }
}
