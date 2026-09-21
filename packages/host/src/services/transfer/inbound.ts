/**
 * The receiving half of a transfer: ordered reassembly onto disk.
 *
 * Bytes land in a staging file next to their destination and are renamed into
 * place only once the declared length and the sender's SHA-256 both check out.
 * A transfer that dies mid-flight — abort, disconnect, bad digest — leaves the
 * staging file deleted and nothing at the destination, so no caller can pick up
 * a half-written file.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  XFER_ABORT,
  XFER_CHUNK,
  XFER_DIGEST_BYTES,
  XFER_END,
  type XferMessage,
} from "./protocol";

/** Where a transfer's bytes are staged and where they finally land. */
export interface InboundDestination {
  stagingPath: string;
  finalPath: string;
  /** Removed alongside the staging file when the transfer fails. */
  cleanupDir?: string;
}

/**
 * Chunks held while an earlier one is missing. The gateway runs over a single
 * ordered WebSocket so this should never fill; it exists so a reordering
 * transport degrades into buffering rather than corruption.
 */
const REORDER_WINDOW = 64;

export class InboundTransfer {
  private handle: fs.promises.FileHandle | null = null;
  private readonly hash = crypto.createHash("sha256");
  /** Serialises the writes `accept()` queues without awaiting. */
  private queue: Promise<void> = Promise.resolve();
  private readonly pending = new Map<number, Uint8Array>();
  private nextSeq = 0;
  private received = 0;
  private endDigest: Uint8Array | null = null;
  private failure: string | null = null;
  private closed = false;

  private constructor(
    readonly destination: InboundDestination,
    readonly declaredSize: number,
    /** Hard ceiling applied to bytes as they arrive, not just the header. */
    private readonly limit: number,
  ) {}

  static async open(
    destination: InboundDestination,
    declaredSize: number,
    limit: number,
  ): Promise<InboundTransfer> {
    if (!Number.isInteger(declaredSize) || declaredSize < 0) {
      throw "Transfer size must be a non-negative integer";
    }
    if (declaredSize > limit) {
      throw sizeMessage(limit);
    }
    const transfer = new InboundTransfer(destination, declaredSize, limit);
    await fs.promises.mkdir(path.dirname(destination.stagingPath), {
      recursive: true,
    });
    transfer.handle = await fs.promises.open(destination.stagingPath, "w");

    return transfer;
  }

  /** Feed one decoded transfer message. Never throws — failures are latched. */
  accept(msg: XferMessage): void {
    if (this.closed) {
      return;
    }
    if (msg.type === XFER_ABORT) {
      this.fail("Transfer aborted by the sender");

      return;
    }
    if (msg.type === XFER_END) {
      if (msg.payload.length !== XFER_DIGEST_BYTES) {
        this.fail("Transfer ended without a checksum");

        return;
      }
      this.endDigest = Uint8Array.from(msg.payload);

      return;
    }
    if (msg.type !== XFER_CHUNK) {
      return;
    }
    if (this.endDigest) {
      this.fail("Chunk arrived after the transfer ended");

      return;
    }
    if (msg.seq < this.nextSeq) {
      this.fail(`Duplicate chunk ${String(msg.seq)}`);

      return;
    }
    if (msg.seq > this.nextSeq) {
      // Out of order: hold it until the gap fills.
      if (this.pending.size >= REORDER_WINDOW) {
        this.fail("Too many chunks arrived out of order");

        return;
      }
      this.pending.set(msg.seq, Uint8Array.from(msg.payload));

      return;
    }
    this.consume(Uint8Array.from(msg.payload));
    while (this.pending.has(this.nextSeq) && !this.failure) {
      const next = this.pending.get(this.nextSeq);
      this.pending.delete(this.nextSeq);
      this.consume(next as Uint8Array);
    }
  }

  /** Account for one in-order chunk and queue its write. */
  private consume(chunk: Uint8Array): void {
    this.nextSeq += 1;
    // The declared total is the sender's claim; this is the ceiling that
    // actually holds, counted as the bytes land.
    if (this.received + chunk.length > this.limit) {
      this.fail(sizeMessage(this.limit));

      return;
    }
    if (this.received + chunk.length > this.declaredSize) {
      this.fail("Transfer sent more bytes than it declared");

      return;
    }
    this.received += chunk.length;
    this.hash.update(chunk);
    this.queue = this.queue.then(async () => {
      if (this.failure || !this.handle) {
        return;
      }
      try {
        await this.handle.write(chunk);
      } catch (e) {
        this.failure = `Failed to stage transfer: ${String(e)}`;
      }
    });
  }

  /** Bytes written so far, for progress reporting. */
  get bytesReceived(): number {
    return this.received;
  }

  private fail(message: string): void {
    this.failure ??= message;
  }

  /**
   * Verify and move the staged file into place.
   *
   * @throws string on any integrity failure, having removed the partial.
   */
  async complete(): Promise<void> {
    if (this.closed) {
      throw "Transfer is no longer open";
    }
    await this.queue;
    try {
      if (this.failure) {
        throw this.failure;
      }
      if (!this.endDigest) {
        throw "Transfer is still in flight";
      }
      if (this.received !== this.declaredSize) {
        throw `Transfer length mismatch: expected ${String(this.declaredSize)} bytes, got ${String(this.received)}`;
      }
      const digest = this.hash.digest();
      if (
        digest.length !== this.endDigest.length ||
        !crypto.timingSafeEqual(digest, Buffer.from(this.endDigest))
      ) {
        throw "Transfer checksum mismatch";
      }
      await this.handle?.close();
      this.handle = null;
      this.closed = true;
      await fs.promises.rename(
        this.destination.stagingPath,
        this.destination.finalPath,
      );
    } catch (e) {
      await this.abort();
      throw typeof e === "string" ? e : String(e);
    }
  }

  /** Drop everything this transfer staged. Safe to call more than once. */
  async abort(): Promise<void> {
    this.closed = true;
    this.pending.clear();
    try {
      await this.handle?.close();
    } catch {
      // Already closed.
    }
    this.handle = null;
    await fs.promises
      .rm(this.destination.stagingPath, { force: true })
      .catch(() => undefined);
    if (this.destination.cleanupDir) {
      await fs.promises
        .rm(this.destination.cleanupDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}

function sizeMessage(limit: number): string {
  return `Transfer exceeds the ${String(Math.round(limit / (1024 * 1024)))} MB limit`;
}
