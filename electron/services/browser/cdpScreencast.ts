/**
 * Raw CDP screencast client — connects directly to Chromium's remote debugging
 * WebSocket to receive Page.screencastFrame events and push JPEG frames to the
 * MJPEG server.
 *
 * No Playwright dependency. The CDP screencast protocol is simple:
 *   1. Target.attachToTarget → sessionId
 *   2. Page.startScreencast → begins streaming
 *   3. Page.screencastFrame event → JPEG frame data
 *   4. Page.screencastFrameAck → acknowledge receipt
 *
 * One active screencast per workspaceId.
 */

import http from "node:http";
import { info, warn } from "../../../app/lib/logger";
import { pushFrame } from "./mjpegServer";

interface ActiveScreencast {
  ws: import("node:stream").Duplex;
  sessionId: string | null;
  closed: boolean;
}

const screencasts = new Map<string, ActiveScreencast>();
let nextId = 1;

// ---------------------------------------------------------------------------
// CDP WebSocket helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the WebSocket debugger URL for a specific target from the CDP HTTP
 * endpoint (`/json` on the remote-debugging-port).
 */
async function resolveWsUrl(
  cdpPort: number,
  targetId: string,
): Promise<string> {
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${cdpPort}/json`,
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () =>
      req.destroy(new Error("CDP /json request timed out")),
    );
  });

  const targets = JSON.parse(body) as Array<{
    id: string;
    webSocketDebuggerUrl?: string;
  }>;

  const target = targets.find((t) => t.id === targetId);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(
      `CDP target ${targetId} not found or missing webSocketDebuggerUrl`,
    );
  }

  return target.webSocketDebuggerUrl;
}

/**
 * Open a raw WebSocket connection to a CDP endpoint. Uses Node's built-in
 * `http.get` upgrade mechanism — no external ws dependency needed.
 *
 * Returns a Duplex stream that speaks the WebSocket wire protocol via a
 * minimal frame encoder/decoder.
 */
function connectCdpWebSocket(
  wsUrl: string,
): Promise<{
  send: (msg: string) => void;
  onMessage: (cb: (data: string) => void) => void;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(wsUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": Buffer.from(
          Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
        ).toString("base64"),
        "Sec-WebSocket-Version": "13",
      },
    };

    const req = http.get(options);
    req.on("upgrade", (_res, socket) => {
      const listeners: Array<(data: string) => void> = [];
      let buffer = Buffer.alloc(0);

      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const frame = parseWsFrame(buffer);
          if (!frame) break;
          buffer = buffer.subarray(frame.totalLength);
          if (frame.opcode === 0x1) {
            const text = frame.payload.toString("utf-8");
            for (const cb of listeners) cb(text);
          } else if (frame.opcode === 0x8) {
            socket.end();
          } else if (frame.opcode === 0x9) {
            // Ping → pong
            socket.write(buildWsFrame(frame.payload, 0xa));
          }
        }
      });

      resolve({
        send: (msg: string) => {
          if (!socket.destroyed) {
            socket.write(buildWsFrame(Buffer.from(msg, "utf-8"), 0x1));
          }
        },
        onMessage: (cb) => listeners.push(cb),
        close: () => {
          if (!socket.destroyed) {
            socket.write(buildWsFrame(Buffer.alloc(0), 0x8));
            socket.end();
          }
        },
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () =>
      req.destroy(new Error("WebSocket upgrade timed out")),
    );
  });
}

/** Parse a single WebSocket frame from a buffer. Returns null if incomplete. */
function parseWsFrame(
  buf: Buffer,
): { opcode: number; payload: Buffer; totalLength: number } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  if (masked) offset += 4;
  if (buf.length < offset + payloadLen) return null;

  let payload = buf.subarray(offset, offset + payloadLen);
  if (masked) {
    const maskKey = buf.subarray(offset - 4, offset);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { opcode, payload, totalLength: offset + payloadLen };
}

/** Build a WebSocket frame (client frames are masked per RFC 6455). */
function buildWsFrame(payload: Buffer, opcode: number): Buffer {
  const mask = Buffer.from([
    Math.random() * 256,
    Math.random() * 256,
    Math.random() * 256,
    Math.random() * 256,
  ].map(Math.floor));

  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payload.length;
    mask.copy(header, 2);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
    mask.copy(header, 10);
  }

  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) {
    masked[i] ^= mask[i % 4];
  }

  return Buffer.concat([header, masked]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScreencastOptions {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
}

/**
 * Start a CDP screencast for a workspace. Connects to the Chromium instance
 * at `cdpPort`, attaches to the given target, and pushes JPEG frames to the
 * MJPEG server.
 */
export async function startScreencast(
  workspaceId: string,
  cdpPort: number,
  targetId: string,
  viewport: ScreencastOptions,
): Promise<void> {
  // Stop any existing screencast for this workspace.
  await stopScreencast(workspaceId);

  const wsUrl = await resolveWsUrl(cdpPort, targetId);
  const ws = await connectCdpWebSocket(wsUrl);

  const state: ActiveScreencast = {
    ws: null as unknown as import("node:stream").Duplex,
    sessionId: null,
    closed: false,
  };
  screencasts.set(workspaceId, state);

  ws.onMessage((data) => {
    if (state.closed) return;
    try {
      const msg = JSON.parse(data);

      if (msg.method === "Page.screencastFrame") {
        const jpeg = Buffer.from(msg.params.data, "base64");
        pushFrame(workspaceId, jpeg);
        ws.send(
          JSON.stringify({
            id: nextId++,
            method: "Page.screencastFrameAck",
            params: { sessionId: msg.params.sessionId },
          }),
        );
      }
    } catch {
      // Malformed message — skip
    }
  });

  // Enable Page domain and start screencast.
  ws.send(
    JSON.stringify({
      id: nextId++,
      method: "Page.startScreencast",
      params: {
        format: "jpeg",
        quality: viewport.quality ?? 80,
        maxWidth: viewport.maxWidth,
        maxHeight: viewport.maxHeight,
        everyNthFrame: 1,
      },
    }),
  );

  // Store close handle so we can tear down later.
  (state as { close?: () => void }).close = () => {
    state.closed = true;
    ws.send(
      JSON.stringify({
        id: nextId++,
        method: "Page.stopScreencast",
      }),
    );
    ws.close();
  };

  info(
    `[cdp-screencast] Started for workspace ${workspaceId} ` +
      `(port=${cdpPort}, target=${targetId})`,
  );
}

/**
 * Stop the screencast for a workspace and close the WebSocket connection.
 */
export async function stopScreencast(workspaceId: string): Promise<void> {
  const state = screencasts.get(workspaceId);
  if (!state) return;

  state.closed = true;
  try {
    const closer = state as unknown as { close?: () => void };
    closer.close?.();
  } catch {
    // Already closed
  }

  screencasts.delete(workspaceId);
  info(`[cdp-screencast] Stopped for workspace ${workspaceId}`);
}

/**
 * Restart screencast after a viewport change (which changes the target ID due
 * to context recreation in Conductor).
 */
export async function restartScreencast(
  workspaceId: string,
  cdpPort: number,
  newTargetId: string,
  viewport: ScreencastOptions,
): Promise<void> {
  await stopScreencast(workspaceId);
  await startScreencast(workspaceId, cdpPort, newTargetId, viewport);
}

/**
 * Stop all active screencasts. Called during app shutdown.
 */
export async function stopAllScreencasts(): Promise<void> {
  const ids = [...screencasts.keys()];
  for (const id of ids) {
    await stopScreencast(id);
  }
}
