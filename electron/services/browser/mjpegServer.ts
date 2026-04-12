/**
 * MJPEG streaming server for embedded browser frames.
 *
 * Receives JPEG frames from CDP screencast and serves them as MJPEG streams
 * over HTTP. Each workspace gets its own stream endpoint. Mirrors the iOS
 * simulator bridge's MJPEG server pattern — the frontend consumes via
 * `<img src="http://127.0.0.1:{port}/stream/{workspaceId}">`.
 */

import http from "node:http";
import { info } from "../../../app/lib/logger";

const BOUNDARY = "stagehand-frame";

/** Connected MJPEG clients per workspace. */
const clients = new Map<string, Set<http.ServerResponse>>();

let server: http.Server | null = null;
let serverPort = 0;

/**
 * Push a JPEG frame to all connected clients for a workspace.
 * Called by the screencast handler in cdpScreencast.
 */
export function pushFrame(workspaceId: string, jpeg: Buffer): void {
  const set = clients.get(workspaceId);
  if (!set || set.size === 0) {
    return;
  }

  const header =
    `--${BOUNDARY}\r\n` +
    `Content-Type: image/jpeg\r\n` +
    `Content-Length: ${jpeg.length}\r\n` +
    `\r\n`;

  const headerBuf = Buffer.from(header);
  const tail = Buffer.from("\r\n");

  for (const res of set) {
    try {
      res.write(headerBuf);
      res.write(jpeg);
      res.write(tail);
    } catch {
      // Client disconnected — clean up on next request or close event.
      set.delete(res);
    }
  }
}

/** Start the MJPEG server. Returns the auto-assigned port. */
export async function startMjpegServer(): Promise<number> {
  if (server) {
    return serverPort;
  }

  server = http.createServer((req, res) => {
    // Parse /stream/{workspaceId}
    const match = req.url?.match(/^\/stream\/([^/?]+)/);
    if (!match) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found — use /stream/{workspaceId}");

      return;
    }

    const workspaceId = decodeURIComponent(match[1]);

    res.writeHead(200, {
      "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });

    let set = clients.get(workspaceId);
    if (!set) {
      set = new Set();
      clients.set(workspaceId, set);
    }
    set.add(res);

    req.on("close", () => {
      set!.delete(res);
      if (set!.size === 0) {
        clients.delete(workspaceId);
      }
    });
  });

  return new Promise<number>((resolve, reject) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (typeof addr === "object" && addr) {
        serverPort = addr.port;
        info(`[mjpeg] Server listening on 127.0.0.1:${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error("Failed to get MJPEG server address"));
      }
    });
    server!.on("error", reject);
  });
}

/** Get the MJPEG server port (0 if not started). */
export function getMjpegPort(): number {
  return serverPort;
}

/** Stop the MJPEG server and close all client connections. */
export function stopMjpegServer(): void {
  if (!server) {
    return;
  }

  for (const [, set] of clients) {
    for (const res of set) {
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
  }
  clients.clear();

  server.close();
  server = null;
  serverPort = 0;
  info("[mjpeg] Server stopped");
}
