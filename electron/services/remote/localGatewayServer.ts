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
import { warn } from "../../../app/lib/logger";
import {
  findDeviceByStaticKey,
  updateLastSeen,
  type DesktopIdentity,
} from "./deviceStore";
import { DeviceConnection, addConnection, removeConnection } from "./gateway";
import { NoiseHandshake } from "./noise";

/** A /pair socket handler supplied by the active pairing session. */
export interface PairingSocketHandler {
  onData: (bytes: Uint8Array, send: (out: Uint8Array) => void) => void;
  onClose: () => void;
}

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let pairingHandler: PairingSocketHandler | null = null;

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
  let file =
    resolved.startsWith(path.resolve(staticDir)) && existsSync(resolved)
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
  });
  createReadStream(file).pipe(res);
}

function handleDeviceSocket(ws: WebSocket, identity: DesktopIdentity): void {
  let handshake: NoiseHandshake | null = null;
  let connection: DeviceConnection | null = null;

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
        if (!device || !handshake) {
          ws.close();

          return;
        }
        send(ws, handshake.writeMessage(new Uint8Array(0)));
        const conn = new DeviceConnection(device, handshake.session(), (out) =>
          send(ws, out),
        );
        conn.setCloser(() => ws.close());
        connection = conn;
        addConnection(conn);
        updateLastSeen(device.device_id, Date.now()).catch(() => {});
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
  ws.on("message", (raw: Buffer) => {
    pairingHandler?.onData(new Uint8Array(raw), (out) => send(ws, out));
  });
  ws.on("close", () => pairingHandler?.onClose());
  ws.on("error", () => ws.close());
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
    const sockets = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const upgradePath = (req.url ?? "").split("?")[0];
      if (upgradePath !== "/device" && upgradePath !== "/pair") {
        socket.destroy();

        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) => {
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
    server.listen(port, opts.host, () => {
      httpServer = server;
      wss = sockets;
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

export function stopLocalGateway(): void {
  pairingHandler = null;
  wss?.close();
  wss = null;
  httpServer?.close();
  httpServer = null;
}
