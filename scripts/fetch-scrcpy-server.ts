/**
 * Downloads the official scrcpy-server binary from GitHub releases.
 *
 * Run via: tsx scripts/fetch-scrcpy-server.ts
 *
 * The binary is saved to native/scrcpy-server/scrcpy-server.jar and is
 * NOT checked into git. It is fetched at install time via the postinstall hook.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration — bump these when upgrading scrcpy
// ---------------------------------------------------------------------------

const SCRCPY_VERSION = "3.1";
const EXPECTED_SHA256 =
  "958f0944a62f23b1f33a16e9eb14844c1a04b882ca175a738c16d23cb22b86c0";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "native", "scrcpy-server");
const OUT_PATH = path.join(OUT_DIR, "scrcpy-server.jar");
const URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function download(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, redirects = 0) => {
      if (redirects > 5) {
        reject(new Error("Too many redirects"));
        return;
      }
      httpsGet(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          const location = res.headers.location;
          if (!location) {
            reject(new Error(`Redirect without Location header`));
            return;
          }
          follow(location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${String(res.statusCode)} for ${u}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Skip if already present with correct hash
  if (existsSync(OUT_PATH)) {
    const existing = readFileSync(OUT_PATH);
    if (sha256(existing) === EXPECTED_SHA256) {
      console.log(
        `[fetch-scrcpy-server] scrcpy-server v${SCRCPY_VERSION} already present (SHA-256 OK)`,
      );
      return;
    }
    console.log(
      `[fetch-scrcpy-server] existing file has wrong hash, re-downloading...`,
    );
  }

  console.log(
    `[fetch-scrcpy-server] Downloading scrcpy-server v${SCRCPY_VERSION}...`,
  );
  const data = await download(URL);

  const hash = sha256(data);
  if (hash !== EXPECTED_SHA256) {
    throw new Error(
      `SHA-256 mismatch!\n  expected: ${EXPECTED_SHA256}\n  got:      ${hash}`,
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, data);
  console.log(
    `[fetch-scrcpy-server] Saved to ${OUT_PATH} (${String(data.length)} bytes, SHA-256 verified)`,
  );
}

main().catch((err) => {
  console.error("[fetch-scrcpy-server] Error:", err);
  process.exit(1);
});
