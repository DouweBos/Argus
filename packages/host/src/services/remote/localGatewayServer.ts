/**
 * Local WebSocket + static server that a tunnel (cloudflared / tailscale) or the
 * LAN exposes. Binds 127.0.0.1 by default (tunnel-only); in LAN mode it binds
 * 0.0.0.0 so other devices on the network can reach it directly.
 *
 * Paths:
 *   /device — steady-state. A client sends Noise IK message 1; we respond, then
 *             identify it by the transmitted static key. Only a pinned device
 *             completes the handshake and gets a capability-gated connection.
 *   /pair   — enrollment. Delegated to the active PairingSession (IKpsk1).
 *   GET *   — the static web client bundle (when a dir is configured), so a LAN
 *             browser can load the client from this same origin.
 *
 * Opening a LAN port does NOT bypass auth: every socket still completes a Noise
 * handshake, and only pinned devices (or a valid pairing PSK) get through.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { warn } from "@argus/host/logger";
import {
  findDeviceByStaticKey,
  updateLastSeen,
  type DesktopIdentity,
} from "./deviceStore";
import {
  DeviceConnection,
  addConnection,
  createGuestConnection,
  removeConnection,
} from "./gateway";
import { hasOpenRooms } from "./huddle";
import { NoiseHandshake } from "./noise";

/** A /pair socket handler supplied by the active pairing session. */
export interface PairingSocketHandler {
  onData: (bytes: Uint8Array, send: (out: Uint8Array) => void) => void;
  onClose: () => void;
}

/**
 * Caps on the unauthenticated pre-handshake surface (LAN- and tunnel-reachable):
 * a frame ceiling well above legit envelopes+image attachments but far below the
 * ws 100 MiB default, a handshake deadline so idle sockets can't be parked, and
 * a total socket cap so an attacker can't exhaust handles/memory before auth.
 */
const MAX_PAYLOAD = 16 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS = 64;

/**
 * How long a guest socket may sit without presenting a room token. Unknown
 * keys are only accepted at all while a room is open, and this stops one
 * parking on the tunnel once it is.
 */
const HUDDLE_JOIN_TIMEOUT_MS = 30_000;

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let pairingHandler: PairingSocketHandler | null = null;
let socketCount = 0;

export function setPairingHandler(handler: PairingSocketHandler | null): void {
  pairingHandler = handler;
}

function send(ws: WebSocket, bytes: Uint8Array): void {
  ws.send(bytes);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Serve the static web client, guarding against path traversal (SPA fallback). */
function serveStatic(
  staticDir: string,
  urlPath: string,
  res: ServerResponse,
): void {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const resolved = path.resolve(staticDir, rel);
  const base = path.resolve(staticDir);
  // Trailing separator so a sibling dir sharing the prefix (e.g. `${base}-x`)
  // can't pass the containment check.
  const inside = resolved === base || resolved.startsWith(base + path.sep);
  let file =
    inside && existsSync(resolved)
      ? resolved
      : path.join(staticDir, "index.html"); // SPA fallback
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(staticDir, "index.html");
  }
  if (!existsSync(file)) {
    res.writeHead(404).end("web client not built");

    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    // The service worker must never be served stale, or a rebuilt client keeps
    // running the old push handler.
    ...(path.basename(file) === "sw.js" ? { "cache-control": "no-cache" } : {}),
  });
  createReadStream(file).pipe(res);
}

/** Drop a guest socket that never presents a room token. */
function armJoinDeadline(ws: WebSocket, conn: DeviceConnection): void {
  const timer = setTimeout(() => {
    if (conn.isUnjoinedGuest()) {
      ws.close();
    }
  }, HUDDLE_JOIN_TIMEOUT_MS);
  timer.unref?.();
  ws.on("close", () => clearTimeout(timer));
}

function handleDeviceSocket(ws: WebSocket, identity: DesktopIdentity): void {
  let handshake: NoiseHandshake | null = null;
  let connection: DeviceConnection | null = null;

  // Drop a socket that never completes the Noise handshake — no parking pre-auth.
  const deadline = setTimeout(() => {
    if (!connection) {
      ws.close();
    }
  }, HANDSHAKE_TIMEOUT_MS);
  deadline.unref?.();
  ws.on("close", () => clearTimeout(deadline));

  ws.on("message", (raw: Buffer) => {
    const bytes = new Uint8Array(raw);
    if (connection) {
      connection.onFrame(bytes).catch(() => {});

      return;
    }
    handshake = new NoiseHandshake({
      role: "responder",
      staticKey: { priv: identity.priv, pub: identity.pub },
    });
    try {
      handshake.readMessage(bytes);
    } catch {
      ws.close();

      return;
    }
    const clientPub = Buffer.from(handshake.remoteStaticKey()).toString(
      "base64",
    );
    findDeviceByStaticKey(clientPub)
      .then((device) => {
        if (!handshake) {
          ws.close();

          return;
        }
        // An unknown key is a huddle guest — but only while a room is open, so
        // with no share running the surface is exactly what it was: pinned
        // devices only. The guest still gets nothing until it presents a valid
        // token AND the host approves it.
        if (!device && !hasOpenRooms()) {
          ws.close();

          return;
        }
        send(ws, handshake.writeMessage(new Uint8Array(0)));
        const conn = device
          ? new DeviceConnection(device, handshake.session(), (out) =>
              send(ws, out),
            )
          : createGuestConnection(clientPub, handshake.session(), (out) =>
              send(ws, out),
            );
        conn.setCloser(() => ws.close());
        conn.setBufferedProbe(() => ws.bufferedAmount);
        connection = conn;
        addConnection(conn);
        if (device) {
          updateLastSeen(device.device_id, Date.now()).catch(() => {});
        } else {
          armJoinDeadline(ws, conn);
        }
      })
      .catch(() => ws.close());
  });

  ws.on("close", () => {
    if (connection) {
      removeConnection(connection);
      connection = null;
    }
  });
  ws.on("error", () => ws.close());
}

function handlePairSocket(ws: WebSocket): void {
  // A legit client sends its handshake immediately, then waits (up to the
  // pairing session's own 2-min timeout) for the user's SAS confirm. Close a
  // socket that sends nothing so silent-idle sockets can't be parked.
  let gotData = false;
  const deadline = setTimeout(() => {
    if (!gotData) {
      ws.close();
    }
  }, HANDSHAKE_TIMEOUT_MS);
  deadline.unref?.();

  ws.on("message", (raw: Buffer) => {
    gotData = true;
    pairingHandler?.onData(new Uint8Array(raw), (out) => send(ws, out));
  });
  ws.on("close", () => {
    clearTimeout(deadline);
    pairingHandler?.onClose();
  });
  ws.on("error", () => ws.close());
}

/** Interface the gateway is actually bound to, or null when it is not up. */
let boundHost: string | null = null;

/**
 * True when the gateway accepts connections from off-box. Pairing must not
 * advertise a LAN address the socket is not listening on.
 */
export function isGatewayOnLan(): boolean {
  return boundHost !== null && boundHost !== "127.0.0.1";
}

export interface LocalGatewayOpts {
  /** Bind address: "127.0.0.1" (tunnel-only) or "0.0.0.0" (LAN). */
  host: string;
  /** Directory of the built web client to serve, or null to skip. */
  staticDir: string | null;
}

export function startLocalGateway(
  port: number,
  identity: DesktopIdentity,
  opts: LocalGatewayOpts = { host: "127.0.0.1", staticDir: null },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (opts.staticDir && req.method === "GET") {
        serveStatic(opts.staticDir, req.url ?? "/", res);
      } else {
        res.writeHead(426).end("upgrade required");
      }
    });
    const sockets = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_PAYLOAD,
    });

    server.on("upgrade", (req, socket, head) => {
      const upgradePath = (req.url ?? "").split("?")[0];
      if (upgradePath !== "/device" && upgradePath !== "/pair") {
        socket.destroy();

        return;
      }
      if (socketCount >= MAX_CONNECTIONS) {
        socket.destroy();

        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) => {
        socketCount += 1;
        ws.once("close", () => {
          socketCount -= 1;
        });
        if (upgradePath === "/device") {
          handleDeviceSocket(ws, identity);
        } else {
          handlePairSocket(ws);
        }
      });
    });

    server.on("error", (err) => {
      warn(`[remote] local gateway server error: ${err.message}`);
      reject(err);
    });
    boundHost = opts.host;
    server.listen(port, opts.host, () => {
      httpServer = server;
      wss = sockets;
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

export function stopLocalGateway(): void {
  boundHost = null;
  pairingHandler = null;
  wss?.close();
  wss = null;
  httpServer?.close();
  httpServer = null;
}
