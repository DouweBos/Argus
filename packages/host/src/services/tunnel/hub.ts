/**
 * One connection's port forwards: each tunnel is a TCP connection from this
 * host to `localhost:<port>`, opened on behalf of one connection the client
 * accepted on its own loopback listener.
 *
 * The client picks the tunnel id before asking, so bytes the host sends right
 * after `tunnel.open` answers already have somewhere to land. Ids are
 * per-connection; a reconnect starts from an empty table.
 */

import net from "node:net";
import { appState } from "../../state";
import {
  TUNNEL_CLOSE,
  TUNNEL_DATA,
  decodeTunnel,
  encodeTunnel,
} from "./protocol";

/** Plenty for a browser's parallel requests plus a dev server's HMR socket. */
export const MAX_TUNNELS = 256;
const CONNECT_TIMEOUT_MS = 5000;
/** Stop reading the dev server once this much is queued for the client. */
const BACKPRESSURE_BYTES = 4 * 1024 * 1024;
const BACKPRESSURE_POLL_MS = 25;
/** Keeps each frame well under the gateway's payload cap. */
const MAX_FRAME_BYTES = 256 * 1024;

export interface TunnelSink {
  send: (body: Uint8Array) => void;
  buffered: () => number;
}

export interface OpenTunnelParams {
  tunnel_id: number;
  session_id: string;
  port: number;
}

export interface TunnelHubOptions {
  connect?: (port: number) => net.Socket;
  sessionExists?: (sessionId: string) => boolean;
}

interface Tunnel {
  socket: net.Socket;
  sessionId: string;
  poll: NodeJS.Timeout | null;
}

export class PortTunnelHub {
  private readonly tunnels = new Map<number, Tunnel>();
  private readonly connect: (port: number) => net.Socket;
  private readonly sessionExists: (sessionId: string) => boolean;

  constructor(
    private readonly sink: TunnelSink,
    options: TunnelHubOptions = {},
  ) {
    // Dev servers bind `localhost`, which is ::1 on some setups and 127.0.0.1 on others.
    this.connect =
      options.connect ??
      ((port) =>
        net.connect({ host: "localhost", port, autoSelectFamily: true }));
    this.sessionExists =
      options.sessionExists ?? ((id) => appState.sessions.has(id));
  }

  get size(): number {
    return this.tunnels.size;
  }

  async open(params: OpenTunnelParams): Promise<Record<string, never>> {
    const id = Number(params.tunnel_id);
    const port = Number(params.port);
    if (!Number.isInteger(id) || id < 1 || id > 0xffff) {
      throw "Invalid tunnel id";
    }
    if (!Number.isInteger(port) || port < 1 || port > 0xffff) {
      throw "Invalid port";
    }
    if (!this.sessionExists(params.session_id)) {
      throw "Unknown session";
    }
    if (this.tunnels.has(id)) {
      throw `Tunnel ${String(id)} is already open`;
    }
    if (this.tunnels.size >= MAX_TUNNELS) {
      throw "Too many forwarded connections are open";
    }

    const socket = this.connect(port);
    const tunnel: Tunnel = { socket, sessionId: params.session_id, poll: null };
    this.tunnels.set(id, tunnel);
    try {
      await connected(socket);
    } catch {
      this.tunnels.delete(id);
      socket.destroy();
      throw `Nothing is listening on port ${String(port)}`;
    }
    // Closed while connecting (session deleted, client gave up).
    if (this.tunnels.get(id) !== tunnel) {
      socket.destroy();
      throw "Tunnel closed";
    }

    socket.on("data", (chunk: Buffer) => {
      for (let at = 0; at < chunk.length; at += MAX_FRAME_BYTES) {
        this.sink.send(
          encodeTunnel(
            TUNNEL_DATA,
            id,
            chunk.subarray(at, at + MAX_FRAME_BYTES),
          ),
        );
      }
      this.throttle(tunnel);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (this.tunnels.get(id) === tunnel) {
        this.drop(id, tunnel);
        this.sink.send(encodeTunnel(TUNNEL_CLOSE, id));
      }
    });

    return {};
  }

  /** Route one inbound body from the client to its tunnel. */
  onBody(body: Uint8Array): void {
    const msg = decodeTunnel(body);
    if (!msg) {
      return;
    }
    const tunnel = this.tunnels.get(msg.tunnelId);
    if (!tunnel) {
      return;
    }
    if (msg.type === TUNNEL_DATA) {
      tunnel.socket.write(msg.payload);
    } else if (msg.type === TUNNEL_CLOSE) {
      // A half-close: the response can still be on its way, and `close` sends ours.
      tunnel.socket.end();
    }
  }

  close(tunnelId: number): void {
    const tunnel = this.tunnels.get(tunnelId);
    if (tunnel) {
      this.drop(tunnelId, tunnel);
      tunnel.socket.destroy();
    }
  }

  /** A deleted session takes its forwards with it. */
  closeSession(sessionId: string): void {
    for (const [id, tunnel] of [...this.tunnels]) {
      if (tunnel.sessionId === sessionId) {
        this.close(id);
        this.sink.send(encodeTunnel(TUNNEL_CLOSE, id));
      }
    }
  }

  dispose(): void {
    for (const id of [...this.tunnels.keys()]) {
      this.close(id);
    }
  }

  private drop(id: number, tunnel: Tunnel): void {
    if (tunnel.poll) {
      clearInterval(tunnel.poll);
      tunnel.poll = null;
    }
    this.tunnels.delete(id);
  }

  /** Pause the dev server while the client's socket is backed up. */
  private throttle(tunnel: Tunnel): void {
    if (tunnel.poll || this.sink.buffered() <= BACKPRESSURE_BYTES) {
      return;
    }
    tunnel.socket.pause();
    tunnel.poll = setInterval(() => {
      if (this.sink.buffered() <= BACKPRESSURE_BYTES) {
        if (tunnel.poll) {
          clearInterval(tunnel.poll);
        }
        tunnel.poll = null;
        tunnel.socket.resume();
      }
    }, BACKPRESSURE_POLL_MS);
  }
}

function connected(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, CONNECT_TIMEOUT_MS);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}
