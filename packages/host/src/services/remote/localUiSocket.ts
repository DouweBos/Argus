/**
 * The local UI channel: how the native Mac app drives the host it supervises.
 *
 * A Unix domain socket at `$ARGUS_HOME/host.sock`, mode 0600 — owning the file
 * is the authentication, so there is no Noise and no pairing. It speaks the
 * gateway's envelopes and frame tags through a pass-through cipher, so dispatch,
 * subscriptions, raw `ipc` events and media frames are all `gateway.ts`. Its
 * connection is the console: every tier, `host` included.
 *
 * Frames on the stream are length-prefixed (u32 big-endian), each carrying the
 * same tagged plaintext a gateway WebSocket message would.
 */

import type { PairedDevice } from "./deviceStore";
import {
  LocalUiMethods,
  type LocalUiMethod,
  type PlatformRequest,
} from "@argus/remote-protocol";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { addHostEventSink } from "@argus/host/bus";
import { log, warn } from "@argus/host/logger";
import { GatewayError } from "./capabilities";
import { DeviceConnection, type FrameCipher } from "./gateway";

/** Matches the gateway's `MAX_PAYLOAD`; a transcript page can be large. */
const MAX_FRAME = 64 * 1024 * 1024;

const PASS_THROUGH: FrameCipher = {
  encrypt: (plain) => plain,
  decrypt: (cipher) => cipher,
};

/** Never persisted, never listed as a paired device. */
function consoleDevice(): PairedDevice {
  return {
    device_id: "local-ui",
    label: "This Mac",
    dev_static_pub: "",
    capabilities: ["monitor", "control", "admin"],
    created_at: Date.now(),
    last_seen: null,
  };
}

export interface NotificationCallbacks {
  onAction?: (index: number) => void;
  onClick?: () => void;
}

/** Banners whose callbacks we still remember; older clicks just do nothing. */
const MAX_NOTIFICATIONS = 200;

/** What one attached UI told us about itself (`ui.state`). */
interface UiPeer {
  conn: DeviceConnection;
  foreground: boolean;
  /** Null until its first `ui.state`: not asked anything before it says. */
  role: LocalUiRole | null;
}

export type LocalUiRole = "platform" | "viewer";

/**
 * The host's side of platform delegation: who is attached, which of them
 * answers platform requests, whose window has focus, and the callbacks for
 * banners it was asked to show.
 *
 * Only `platform` UIs (the app supervising this host) get the host's own asks —
 * banners, raising the window. A `viewer` (a window attached to a host another
 * app runs) gets only what it asked for itself and what every window must hear.
 */
export class LocalUiChannel {
  private readonly peers = new Map<string, UiPeer>();
  private readonly notifications = new Map<string, NotificationCallbacks>();
  private nextId = 1;

  get attached(): boolean {
    return this.peers.size > 0;
  }

  /** Some attached UI answers platform requests. */
  get hasPlatform(): boolean {
    return this.platformPeers().length > 0;
  }

  /** Any attached window has focus: the user is looking at Argus. */
  isForeground(): boolean {
    return [...this.peers.values()].some((peer) => peer.foreground);
  }

  /** The attached UI the running request came from, if it came from one. */
  requester(connectionId: string | null): DeviceConnection | null {
    return connectionId ? (this.peers.get(connectionId)?.conn ?? null) : null;
  }

  /** Ask the platform UIs; false when there is none to ask. */
  send(request: PlatformRequest): boolean {
    const targets = this.platformPeers();
    for (const peer of targets) {
      peer.conn.pushPlatformRequest(request);
    }

    return targets.length > 0;
  }

  /** Tell every attached window, viewers included. */
  sendAll(request: PlatformRequest): boolean {
    for (const peer of this.peers.values()) {
      peer.conn.pushPlatformRequest(request);
    }

    return this.attached;
  }

  /** Show a banner, remembering its callbacks until it is answered. */
  notify(
    request: Omit<PlatformRequest, "id" | "kind">,
    callbacks: NotificationCallbacks,
  ): boolean {
    const id = `n${this.nextId++}`;
    if (!this.send({ ...request, kind: "notify", id })) {
      return false;
    }
    this.notifications.set(id, callbacks);
    if (this.notifications.size > MAX_NOTIFICATIONS) {
      const oldest = this.notifications.keys().next().value;
      if (oldest !== undefined) {
        this.notifications.delete(oldest);
      }
    }

    return true;
  }

  /** `ui.*` methods; null for anything else, which falls through to dispatch. */
  route(
    conn: DeviceConnection,
    method: string,
    params: unknown,
  ): Promise<unknown> | null {
    if (!(method in LocalUiMethods)) {
      return null;
    }
    const parsed = LocalUiMethods[method as LocalUiMethod].safeParse(params);
    if (!parsed.success) {
      return Promise.reject(
        new GatewayError("bad_request", `invalid ${method}`),
      );
    }
    const data = parsed.data as Record<string, unknown>;
    if (method === "ui.state") {
      const peer = this.peers.get(conn.connectionId);
      if (peer) {
        peer.foreground = Boolean(data.foreground);
        // An app from before roles always supervised its host.
        peer.role = (data.role as LocalUiRole | undefined) ?? "platform";
      }
    } else {
      const id = String(data.id);
      const callbacks = this.notifications.get(id);
      this.notifications.delete(id);
      const action = data.action as number | null;
      if (action === null) {
        callbacks?.onClick?.();
      } else {
        callbacks?.onAction?.(action);
      }
    }

    return Promise.resolve({});
  }

  add(conn: DeviceConnection): void {
    this.peers.set(conn.connectionId, { conn, foreground: false, role: null });
  }

  remove(conn: DeviceConnection): void {
    this.peers.delete(conn.connectionId);
  }

  broadcast(channel: string, args: unknown[]): void {
    for (const peer of this.peers.values()) {
      peer.conn.handleBroadcast(channel, args);
    }
  }

  private platformPeers(): UiPeer[] {
    return [...this.peers.values()].filter((peer) => peer.role === "platform");
  }
}

export interface LocalUiServer {
  path: string;
  channel: LocalUiChannel;
  close: () => Promise<void>;
}

/** Split a byte stream into length-prefixed frames. */
export function frameReader(
  onFrame: (frame: Uint8Array) => void,
  onError: () => void,
): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (length > MAX_FRAME) {
        onError();

        return;
      }
      if (buffer.length < 4 + length) {
        return;
      }
      onFrame(new Uint8Array(buffer.subarray(4, 4 + length)));
      buffer = buffer.subarray(4 + length);
    }
  };
}

export function encodeFrame(bytes: Uint8Array): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length, 0);

  return Buffer.concat([header, bytes]);
}

function attach(socket: net.Socket, channel: LocalUiChannel): void {
  const conn: DeviceConnection = new DeviceConnection(
    consoleDevice(),
    PASS_THROUGH,
    (bytes) => {
      if (!socket.destroyed) {
        socket.write(encodeFrame(bytes));
      }
    },
    undefined,
    {
      console: true,
      localRoute: (method, params) => channel.route(conn, method, params),
    },
  );
  conn.setCloser(() => socket.destroy());
  conn.setBufferedProbe(() => socket.writableLength);
  channel.add(conn);

  // `onFrame` reads, sequences and subscribes synchronously, so frames still
  // land in arrival order; only request handlers run concurrently, as on the
  // gateway — one slow command must not hold up every request behind it.
  socket.on(
    "data",
    frameReader(
      (frame) => {
        conn.onFrame(frame).catch(() => undefined);
      },
      () => socket.destroy(),
    ),
  );
  socket.on("close", () => {
    channel.remove(conn);
    conn.dispose();
  });
  socket.on("error", () => socket.destroy());
}

/**
 * Listen on `socketPath`. A stale socket file from a crashed host is replaced;
 * the file is created 0600 (via umask, so there's no window where it isn't).
 */
export async function startLocalUiSocket(
  socketPath: string,
  channel = new LocalUiChannel(),
): Promise<LocalUiServer> {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Nothing stale to remove.
  }

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    attach(socket, channel);
  });
  const untap = addHostEventSink((name, args) => channel.broadcast(name, args));

  const listening = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve();
    });
  });
  // A path socket binds inside `listen()` itself, so the umask is back before
  // anything else runs — held across the await, every file the host created
  // meanwhile came out 0600, directories included.
  const previous = process.umask(0o177);
  try {
    server.listen(socketPath);
  } finally {
    process.umask(previous);
  }
  await listening;
  fs.chmodSync(socketPath, 0o600);
  server.on("error", (err) => warn(`[local-ui] ${String(err)}`));
  log(`[local-ui] listening on ${socketPath}`);

  return {
    path: socketPath,
    channel,
    close: () =>
      new Promise<void>((resolve) => {
        untap();
        server.close(() => resolve());
        for (const socket of sockets) {
          socket.destroy();
        }
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Already gone.
        }
      }),
  };
}
