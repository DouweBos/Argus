/**
 * Direct HTTP client for conductor's injected in-process control server.
 *
 * Simulator apps share the host loopback, so once an app is launched with
 * `launch-app --inject` we can reach its control server on `127.0.0.1:<port>`
 * — the same endpoint the conductor CLI hits. Talking to it directly (instead
 * of shelling out to `native-inspect` and parsing stdout) avoids the CLI's
 * pipe-buffer truncation on large trees: `process.exit(0)` can fire before a
 * multi-KB `console.log` drains, cutting the JSON off mid-object. HTTP has a
 * proper end-of-body, so the whole tree always arrives.
 *
 * The port is assigned deterministically per device at inject time and written
 * to `~/.conductor/inproc-ports.json`; we read it back (never allocate).
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const PORT_FILE = path.join(os.homedir(), ".conductor", "inproc-ports.json");

/** Deterministic in-process port for a device, or null if none is assigned. */
export function readInprocPort(deviceId: string): number | null {
  try {
    const state = JSON.parse(fs.readFileSync(PORT_FILE, "utf-8")) as {
      assignments?: Record<string, number>;
    };
    const port = state.assignments?.[deviceId];

    return typeof port === "number" ? port : null;
  } catch {
    return null;
  }
}

/** GET a JSON endpoint on the in-process server, reading the full body. */
export function inprocGetJson<T>(
  port: number,
  reqPath: string,
  timeoutMs = 20000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: reqPath, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(
              new Error(
                `in-proc ${reqPath} returned invalid JSON (${text.length} bytes): ${text.slice(0, 200)}`,
              ),
            );
          }
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error("in-proc request timed out")),
    );
    req.on("error", reject);
    req.end();
  });
}
