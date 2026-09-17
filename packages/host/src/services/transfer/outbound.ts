/**
 * The sending half of a transfer: a file pumped out as ordered chunks.
 *
 * The difference from video is the whole point. `videoForward` drops delta
 * frames once the socket's buffer passes `BACKPRESSURE_LIMIT`, because a lost
 * frame costs staleness. A lost chunk costs the file, so this pauses the read
 * loop until the socket drains and only gives up — cleanly, with an abort — if
 * it never does.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import {
  XFER_ABORT,
  XFER_CHUNK,
  XFER_CHUNK_BYTES,
  XFER_END,
  encodeXfer,
} from "./protocol";

/** Pause sending once the socket has this many bytes queued (matches video). */
export const XFER_BACKPRESSURE_LIMIT = 1_000_000;

/** How long the socket may stay blocked before the transfer is abandoned. */
const DRAIN_TIMEOUT_MS = 60_000;

const DRAIN_POLL_MS = 20;

export interface OutboundOptions {
  path: string;
  transferId: number;
  /** Emit one transfer message body on the encrypted channel. */
  send: (body: Uint8Array) => void;
  /** Bytes currently queued on the socket. */
  buffered: () => number;
  /** True once the caller wants the pump to stop (abort, disconnect). */
  cancelled: () => boolean;
  /** Called with the running byte count, for progress. */
  onProgress?: (bytesSent: number) => void;
  chunkBytes?: number;
  backpressureLimit?: number;
  /** Injectable for tests; defaults to a real timer. */
  delay?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stream a file to the peer as chunks followed by an `end` message carrying the
 * SHA-256 of everything sent. Resolves once the last byte is queued.
 *
 * @throws string if the read fails or the socket never drains; an abort message
 *   is sent first so the receiver discards its partial.
 */
export async function pumpFile(options: OutboundOptions): Promise<void> {
  const chunkBytes = options.chunkBytes ?? XFER_CHUNK_BYTES;
  const limit = options.backpressureLimit ?? XFER_BACKPRESSURE_LIMIT;
  const delay = options.delay ?? sleep;
  const hash = crypto.createHash("sha256");

  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(options.path, "r");
  } catch (e) {
    throw `Failed to open ${options.path}: ${String(e)}`;
  }

  const buffer = Buffer.allocUnsafe(chunkBytes);
  let seq = 0;
  let sent = 0;
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkBytes, null);
      if (bytesRead === 0) {
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);

      // Block, never drop.
      let waited = 0;
      while (options.buffered() > limit && !options.cancelled()) {
        if (waited >= DRAIN_TIMEOUT_MS) {
          throw "Transfer stalled: the connection stopped draining";
        }
        await delay(DRAIN_POLL_MS);
        waited += DRAIN_POLL_MS;
      }
      if (options.cancelled()) {
        return;
      }

      options.send(encodeXfer(XFER_CHUNK, options.transferId, seq, chunk));
      seq += 1;
      sent += bytesRead;
      options.onProgress?.(sent);
    }
    if (options.cancelled()) {
      return;
    }
    options.send(encodeXfer(XFER_END, options.transferId, seq, hash.digest()));
  } catch (e) {
    options.send(encodeXfer(XFER_ABORT, options.transferId, seq));
    throw typeof e === "string" ? e : String(e);
  } finally {
    await handle.close().catch(() => undefined);
  }
}
