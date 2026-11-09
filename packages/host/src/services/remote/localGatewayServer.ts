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
 *   GET /huddle/host-key — the desktop's static public key, so a huddle guest
 *             with only a link can handshake. Served only while a room is open.
 *   GET /__argus/health — unauthenticated liveness probe, so a caller can tell
 *             a tunnel that published a URL from one that actually reaches us.
 *   GET *   — the static web client bundle (when a dir is configured). Over a
 *             tunnel or the tailnet always; to a direct local-network browser
 *             only with `lanWebClient` on, since that hop is plain http.
 *
 * Opening a LAN port does NOT bypass auth: every socket still completes a Noise
 * handshake, and only pinned devices (or a valid pairing PSK) get through.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { warn } from "@argus/host/logger";
import { findAccountDeviceFresh, syncSoon } from "../account/lifecycle";
import { accountAllowsDevice, currentState } from "../account/trust";
import { capture } from "../telemetry/telemetry";
import {
  findDeviceByStaticKey,
  updateLastSeen,
  type DesktopIdentity,
  type PairedDevice,
} from "./deviceStore";
import { isDirectLanPeer } from "./endpoints";
import {
  DeviceConnection,
  addConnection,
  createGuestConnection,
  removeConnection,
} from "./gateway";
import { HEALTH_PATH, healthBody } from "./gatewayHealth";
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

/** What a direct local-network browser sees while the web client is off for it. */
const LAN_WEB_OFF_PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Argus</title>
<h1>Argus</h1>
<p>The web client isn't served on this network, because it would travel unencrypted.</p>
<p>Open it through this computer's tunnel address or at houwert.dev/argus/app,
or turn on <b>Web client on this network</b> in Argus under Settings, Remote Access.</p>
`;

function serveLanWebOff(res: ServerResponse): void {
  res
    .writeHead(403, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
    })
    .end(LAN_WEB_OFF_PAGE);
}

/** Path a huddle guest reads the host's static public key from. */
export const HOST_KEY_PATH = "/huddle/host-key";

/**
 * The host's static public key, so a guest with only a link can run the Noise
 * IK handshake — it has no pairing to learn the key from. Public by design
 * (pairing prints it in the QR) and served only while a room is open, so a
 * host that is not sharing publishes nothing.
 */
function serveHostKey(identity: DesktopIdentity, res: ServerResponse): void {
  if (!hasOpenRooms()) {
    res.writeHead(404).end("no huddle");

    return;
  }
  res
    .writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    })
    .end(
      JSON.stringify({ ds_pub: Buffer.from(identity.pub).toString("base64") }),
    );
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

/** Device id → day it last reported a connection, so the event fires once a day. */
const connectionReported = new Map<string, string>();

function reportConnection(device: PairedDevice): void {
  const day = new Date().toISOString().slice(0, 10);
  if (connectionReported.get(device.device_id) === day) {
    return;
  }
  connectionReported.set(device.device_id, day);
  const member = currentState()?.members[device.device_id]?.member;
  capture("remote_connection_opened", {
    trust: device.source === "account" ? "account" : "paired",
    hosted_web: member?.role === "device" && member.kind === "web",
  });
}

/**
 * Who a handshaking key is, in order (§4.3): a QR-paired device, then a live
 * device on this host's account (materialized on first sight). An account
 * device the log no longer lists is refused even though its record exists.
 */
async function resolveDevice(clientPub: string): Promise<{
  device: PairedDevice | null;
  refused: boolean;
}> {
  const paired = await findDeviceByStaticKey(clientPub);
  if (paired) {
    return accountAllowsDevice(paired)
      ? { device: paired, refused: false }
      : { device: null, refused: true };
  }

  return { device: await findAccountDeviceFresh(clientPub), refused: false };
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
    resolveDevice(clientPub)
      .then(({ device, refused }) => {
        if (!handshake || refused) {
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
          reportConnection(device);
          if (device.source === "account") {
            syncSoon();
          }
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
  /** Whether a direct local-network browser may load the web client. */
  lanWebClient?: () => boolean;
}

export function startLocalGateway(
  port: number,
  identity: DesktopIdentity,
  opts: LocalGatewayOpts = { host: "127.0.0.1", staticDir: null },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const route = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && route === HEALTH_PATH) {
        res
          .writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store",
          })
          .end(healthBody());
      } else if (req.method === "GET" && route === HOST_KEY_PATH) {
        serveHostKey(identity, res);
      } else if (opts.staticDir && req.method === "GET") {
        if (
          isDirectLanPeer(req.socket.remoteAddress) &&
          !opts.lanWebClient?.()
        ) {
          serveLanWebOff(res);
        } else {
          serveStatic(opts.staticDir, req.url ?? "/", res);
        }
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
