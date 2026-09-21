/**
 * One connection's transfers, in both directions.
 *
 * The control plane stays on the JSON request/response layer (`transfer.*`
 * methods on the gateway); this owns the state those calls manipulate and the
 * binary chunks that flow between them. Ids are per-connection, so a reconnect
 * starts from an empty table and nothing survives a socket.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveContainedPath } from "../file/operations";
import {
  MAX_UPLOAD_BYTES,
  prepareAttachmentDestination,
} from "../file/uploads";
import { InboundTransfer } from "./inbound";
import { pumpFile } from "./outbound";
import { XFER_CHUNK_BYTES, decodeXfer } from "./protocol";

/** Where a client may send bytes. Fixed when the transfer opens. */
export type UploadPurpose = "attachment" | "file";

export interface OpenUploadParams {
  purpose: UploadPurpose;
  session_id: string;
  /** Leaf name for an attachment; the destination path for `purpose: "file"`. */
  name: string;
  size: number;
}

export interface OpenUploadResult {
  transfer_id: number;
  chunk_size: number;
  max_bytes: number;
}

export interface UploadResult {
  path: string;
  name: string;
  size: number;
}

export interface OpenDownloadParams {
  session_id: string;
  path: string;
}

export interface OpenDownloadResult {
  transfer_id: number;
  name: string;
  size: number;
  chunk_size: number;
}

/** What the hub needs from the connection carrying it. */
export interface TransferSink {
  /** Send one transfer message body on the encrypted channel. */
  send: (body: Uint8Array) => void;
  /** Bytes queued on the socket right now, for backpressure. */
  buffered: () => number;
}

interface InboundEntry {
  transfer: InboundTransfer;
  purpose: UploadPurpose;
  name: string;
  size: number;
}

export class TransferHub {
  private readonly inbound = new Map<number, InboundEntry>();
  private readonly outbound = new Map<number, { cancel: () => void }>();
  private nextId = 1;

  constructor(private readonly sink: TransferSink) {}

  private allocId(): number {
    for (let i = 0; i < 0xffff; i++) {
      const id = this.nextId;
      this.nextId = (this.nextId + 1) & 0xffff || 1;
      if (!this.inbound.has(id) && !this.outbound.has(id)) {
        return id;
      }
    }
    throw "Too many transfers are open on this connection";
  }

  // --- client → host ---------------------------------------------------------

  async openUpload(params: OpenUploadParams): Promise<OpenUploadResult> {
    const size = Number(params.size);
    if (!Number.isInteger(size) || size < 0) {
      throw "Transfer size must be a non-negative integer";
    }
    if (size > MAX_UPLOAD_BYTES) {
      throw `Transfer exceeds the ${String(Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)))} MB limit`;
    }

    const destination =
      params.purpose === "attachment"
        ? await attachmentDestination(params.session_id, params.name)
        : await fileDestination(params.session_id, params.name);

    const id = this.allocId();
    const transfer = await InboundTransfer.open(
      destination,
      size,
      MAX_UPLOAD_BYTES,
    );
    this.inbound.set(id, {
      transfer,
      purpose: params.purpose,
      name: path.basename(destination.finalPath),
      size,
    });

    return {
      transfer_id: id,
      chunk_size: XFER_CHUNK_BYTES,
      max_bytes: MAX_UPLOAD_BYTES,
    };
  }

  /** Route one inbound binary body to its transfer. */
  onBody(body: Uint8Array): void {
    const msg = decodeXfer(body);
    if (!msg) {
      return;
    }
    this.inbound.get(msg.transferId)?.transfer.accept(msg);
  }

  async completeUpload(transferId: number): Promise<UploadResult> {
    const entry = this.inbound.get(transferId);
    if (!entry) {
      throw `Unknown transfer ${String(transferId)}`;
    }
    this.inbound.delete(transferId);
    await entry.transfer.complete();

    return {
      path: entry.transfer.destination.finalPath,
      name: entry.name,
      size: entry.size,
    };
  }

  // --- host → client ---------------------------------------------------------

  async openDownload(params: OpenDownloadParams): Promise<OpenDownloadResult> {
    const target = await resolveContainedPath(params.session_id, params.path, {
      mustExist: true,
    });
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) {
      throw `Not a file: ${params.path}`;
    }

    const id = this.allocId();
    let cancelled = false;
    this.outbound.set(id, {
      cancel: () => {
        cancelled = true;
      },
    });

    // Start after the response is on the wire, so the client has the id before
    // the first chunk lands.
    setTimeout(() => {
      pumpFile({
        path: target,
        transferId: id,
        send: (b) => this.sink.send(b),
        buffered: () => this.sink.buffered(),
        cancelled: () => cancelled,
      })
        .catch(() => undefined)
        .finally(() => this.outbound.delete(id))
        .catch(() => undefined);
    }, 0);

    return {
      transfer_id: id,
      name: path.basename(target),
      size: stat.size,
      chunk_size: XFER_CHUNK_BYTES,
    };
  }

  // --- teardown --------------------------------------------------------------

  /** Cancel one transfer in either direction and drop anything it staged. */
  abort(transferId: number): void {
    this.outbound.get(transferId)?.cancel();
    this.outbound.delete(transferId);
    const entry = this.inbound.get(transferId);
    if (entry) {
      this.inbound.delete(transferId);
      entry.transfer.abort().catch(() => undefined);
    }
  }

  /** The connection went away: nothing in flight may outlive it. */
  dispose(): void {
    for (const id of [...this.inbound.keys(), ...this.outbound.keys()]) {
      this.abort(id);
    }
  }
}

/** Staging slot for a dropped file, outside the worktree under `ARGUS_HOME`. */
async function attachmentDestination(sessionId: string, name: string) {
  const { dir, finalPath, stagingPath } = await prepareAttachmentDestination(
    sessionId,
    name,
  );

  return { finalPath, stagingPath, cleanupDir: dir };
}

/**
 * Staging slot for a write into a session. Containment runs here, once, with
 * the same `resolveContainedPath` the JSON `write_file` uses — chunks carry an
 * id and nothing else, so there is no later opportunity to redirect the write.
 */
async function fileDestination(sessionId: string, requested: string) {
  const finalPath = await resolveContainedPath(sessionId, requested, {
    mustExist: false,
  });
  const stagingPath = path.join(
    path.dirname(finalPath),
    `.${path.basename(finalPath)}.argus-part-${crypto.randomUUID()}`,
  );

  return { finalPath, stagingPath };
}
