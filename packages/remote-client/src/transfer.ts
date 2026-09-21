/**
 * The client half of the chunked transfer channel.
 *
 * Control (`transfer.*`) rides the ordinary request/response layer; the bytes
 * ride `TAG_XFER`. Uploads pause when the socket's send buffer fills rather
 * than dropping chunks — unlike video, where a dropped frame only costs
 * staleness — and both directions carry a streaming SHA-256 the far end checks
 * before the transfer counts as finished.
 */

import { sha256 } from "@noble/hashes/sha2.js";

/** Mirrors the host's `protocol.ts`; any change must land on both sides. */
export const XFER_CHUNK = 0;
export const XFER_END = 1;
export const XFER_ABORT = 2;
export const XFER_HEADER_BYTES = 12;
export const XFER_DIGEST_BYTES = 32;

/** Pause sending once the socket has this many bytes queued. */
const BACKPRESSURE_LIMIT = 1_000_000;
const DRAIN_POLL_MS = 20;
const DRAIN_TIMEOUT_MS = 60_000;

export interface TransferProgress {
  transferred: number;
  total: number;
}

/** Bytes to send, read lazily so a 500 MB file never lands in memory at once. */
export interface TransferSource {
  size: number;
  slice: (start: number, end: number) => Promise<Uint8Array>;
}

/** A `TransferSource` over bytes already in hand. */
export function bytesSource(bytes: Uint8Array): TransferSource {
  return {
    size: bytes.length,
    slice: (start, end) => Promise.resolve(bytes.subarray(start, end)),
  };
}

/** A `TransferSource` over a browser `File`/`Blob`. */
export function blobSource(blob: Blob): TransferSource {
  return {
    size: blob.size,
    slice: async (start, end) =>
      new Uint8Array(await blob.slice(start, end).arrayBuffer()),
  };
}

export interface UploadSpec {
  /** `attachment` stages outside the worktree; `file` writes into the session. */
  purpose: "attachment" | "file";
  sessionId: string;
  /** Leaf name for an attachment, destination path for `purpose: "file"`. */
  name: string;
}

export interface UploadResult {
  path: string;
  name: string;
  size: number;
}

export interface TransferIO {
  request: <T>(method: string, params: unknown) => Promise<T>;
  sendXfer: (body: Uint8Array) => void;
  buffered: () => number;
}

function encodeXfer(
  type: number,
  transferId: number,
  seq: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const body = new Uint8Array(XFER_HEADER_BYTES + payload.length);
  const view = new DataView(body.buffer);
  view.setUint8(0, type);
  view.setUint8(1, 0);
  view.setUint16(2, transferId & 0xffff, true);
  view.setUint32(4, seq >>> 0, true);
  view.setUint32(8, 0, true);
  body.set(payload, XFER_HEADER_BYTES);

  return body;
}

interface Download {
  chunks: Uint8Array[];
  received: number;
  nextSeq: number;
  total: number;
  hash: ReturnType<typeof sha256.create>;
  settle: (result: { bytes?: Uint8Array; error?: string }) => void;
  onProgress?: (p: TransferProgress) => void;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class TransferChannel {
  private readonly downloads = new Map<number, Download>();

  constructor(
    private readonly io: TransferIO,
    private readonly delay: (ms: number) => Promise<void> = sleep,
  ) {}

  /** Send a file to the host and get back the path it landed on. */
  async upload(
    spec: UploadSpec,
    source: TransferSource,
    onProgress?: (p: TransferProgress) => void,
  ): Promise<UploadResult> {
    const open = await this.io.request<{
      transfer_id: number;
      chunk_size: number;
    }>("transfer.upload.open", {
      purpose: spec.purpose,
      session_id: spec.sessionId,
      name: spec.name,
      size: source.size,
    });

    const hash = sha256.create();
    let seq = 0;
    let sent = 0;
    try {
      onProgress?.({ transferred: 0, total: source.size });
      while (sent < source.size) {
        const end = Math.min(sent + open.chunk_size, source.size);
        const chunk = await source.slice(sent, end);
        hash.update(chunk);
        await this.waitForDrain();
        this.io.sendXfer(encodeXfer(XFER_CHUNK, open.transfer_id, seq, chunk));
        seq += 1;
        sent = end;
        onProgress?.({ transferred: sent, total: source.size });
      }
      this.io.sendXfer(
        encodeXfer(XFER_END, open.transfer_id, seq, hash.digest()),
      );

      return await this.io.request<UploadResult>("transfer.upload.complete", {
        transfer_id: open.transfer_id,
      });
    } catch (err) {
      this.io.sendXfer(encodeXfer(XFER_ABORT, open.transfer_id, seq));
      await this.io
        .request("transfer.abort", { transfer_id: open.transfer_id })
        .catch(() => undefined);
      throw err;
    }
  }

  /** Pull a file off the host as chunks; resolves once the digest checks out. */
  async download(
    sessionId: string,
    path: string,
    onProgress?: (p: TransferProgress) => void,
  ): Promise<{ bytes: Uint8Array; name: string }> {
    const open = await this.io.request<{
      transfer_id: number;
      name: string;
      size: number;
    }>("transfer.download.open", { session_id: sessionId, path });

    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      this.downloads.set(open.transfer_id, {
        chunks: [],
        received: 0,
        nextSeq: 0,
        total: open.size,
        hash: sha256.create(),
        onProgress,
        settle: (result) => {
          this.downloads.delete(open.transfer_id);
          if (result.bytes) {
            resolve(result.bytes);
          } else {
            reject(new Error(result.error ?? "transfer failed"));
          }
        },
      });
    });

    return { bytes, name: open.name };
  }

  /** Feed one inbound transfer message body (after the transport's tag). */
  pushFrame(body: Uint8Array): void {
    if (body.length < XFER_HEADER_BYTES) {
      return;
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const type = view.getUint8(0);
    const transferId = view.getUint16(2, true);
    const seq = view.getUint32(4, true);
    const payload = body.subarray(XFER_HEADER_BYTES);
    const entry = this.downloads.get(transferId);
    if (!entry) {
      return;
    }

    if (type === XFER_ABORT) {
      entry.settle({ error: "the host aborted the transfer" });

      return;
    }
    if (type === XFER_CHUNK) {
      if (seq !== entry.nextSeq) {
        entry.settle({ error: `chunk ${String(seq)} arrived out of order` });

        return;
      }
      const copy = Uint8Array.from(payload);
      entry.nextSeq += 1;
      entry.received += copy.length;
      entry.hash.update(copy);
      entry.chunks.push(copy);
      entry.onProgress?.({ transferred: entry.received, total: entry.total });

      return;
    }
    if (type !== XFER_END) {
      return;
    }
    if (entry.received !== entry.total) {
      entry.settle({ error: "transfer length mismatch" });

      return;
    }
    const digest = entry.hash.digest();
    if (
      payload.length !== XFER_DIGEST_BYTES ||
      !digest.every((b, i) => b === payload[i])
    ) {
      entry.settle({ error: "transfer checksum mismatch" });

      return;
    }
    const out = new Uint8Array(entry.received);
    let offset = 0;
    for (const chunk of entry.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    entry.settle({ bytes: out });
  }

  /** The socket went away: nothing in flight may hang waiting for it. */
  reset(): void {
    for (const entry of [...this.downloads.values()]) {
      entry.settle({ error: "connection lost" });
    }
    this.downloads.clear();
  }

  /**
   * Block until the socket has drained. A dropped chunk corrupts the file, so
   * this waits where the video path would have shed a frame.
   */
  private async waitForDrain(): Promise<void> {
    let waited = 0;
    while (this.io.buffered() > BACKPRESSURE_LIMIT) {
      if (waited >= DRAIN_TIMEOUT_MS) {
        throw new Error("transfer stalled: the connection stopped draining");
      }
      await this.delay(DRAIN_POLL_MS);
      waited += DRAIN_POLL_MS;
    }
  }
}
