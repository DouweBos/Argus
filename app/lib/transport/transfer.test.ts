/**
 * The client half of the transfer channel. The property worth pinning is that
 * it *blocks* on a full socket — video sheds frames there, and a shed chunk
 * would corrupt the file.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it, vi } from "vitest";
import {
  TransferChannel,
  XFER_CHUNK,
  XFER_END,
  XFER_HEADER_BYTES,
  bytesSource,
} from "@argus/remote-client";

function header(body: Uint8Array) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  return {
    type: view.getUint8(0),
    transferId: view.getUint16(2, true),
    seq: view.getUint32(4, true),
    payload: body.subarray(XFER_HEADER_BYTES),
  };
}

function encode(
  type: number,
  transferId: number,
  seq: number,
  payload: Uint8Array,
) {
  const body = new Uint8Array(XFER_HEADER_BYTES + payload.length);
  const view = new DataView(body.buffer);
  view.setUint8(0, type);
  view.setUint16(2, transferId, true);
  view.setUint32(4, seq, true);
  body.set(payload, XFER_HEADER_BYTES);

  return body;
}

describe("transferChannel upload", () => {
  it("sends ordered chunks and a digest, then completes", async () => {
    const sent: Uint8Array[] = [];
    const payload = Uint8Array.from({ length: 20 }, (_, i) => i);
    const request = vi.fn(async (method: string) =>
      method === "transfer.upload.open"
        ? { transfer_id: 7, chunk_size: 8 }
        : { path: "/host/a.bin", name: "a.bin", size: 20 },
    );
    const channel = new TransferChannel({
      request: request as never,
      sendXfer: (b) => sent.push(b),
      buffered: () => 0,
    });

    const progress: number[] = [];
    const result = await channel.upload(
      { purpose: "attachment", sessionId: "s1", name: "a.bin" },
      bytesSource(payload),
      (p) => progress.push(p.transferred),
    );

    expect(result.path).toBe("/host/a.bin");
    expect(sent).toHaveLength(4); // 3 chunks of 8/8/4, then the end marker
    expect(sent.map((b) => header(b).seq)).toEqual([0, 1, 2, 3]);
    expect(header(sent[3]).type).toBe(XFER_END);
    expect(Array.from(header(sent[3]).payload)).toEqual(
      Array.from(sha256(payload)),
    );
    expect(progress).toEqual([0, 8, 16, 20]);
  });

  it("blocks while the socket is full rather than dropping a chunk", async () => {
    const sent: Uint8Array[] = [];
    let full = true;
    let waits = 0;
    const channel = new TransferChannel(
      {
        request: (async (method: string) =>
          method === "transfer.upload.open"
            ? { transfer_id: 1, chunk_size: 8 }
            : { path: "/host/a.bin", name: "a.bin", size: 16 }) as never,
        sendXfer: (b) => sent.push(b),
        buffered: () => (full ? 5_000_000 : 0),
      },
      async () => {
        waits += 1;
        expect(sent).toHaveLength(0);
        if (waits >= 4) {
          full = false;
        }
      },
    );

    await channel.upload(
      { purpose: "attachment", sessionId: "s1", name: "a.bin" },
      bytesSource(new Uint8Array(16)),
    );

    expect(waits).toBeGreaterThanOrEqual(4);
    expect(sent).toHaveLength(3); // nothing was shed
  });

  it("aborts on the wire when the host refuses the transfer", async () => {
    const sent: Uint8Array[] = [];
    const request = vi.fn(async (method: string) => {
      if (method === "transfer.upload.open") {
        return { transfer_id: 2, chunk_size: 8 };
      }
      if (method === "transfer.upload.complete") {
        throw new Error("Transfer checksum mismatch");
      }

      return null;
    });
    const channel = new TransferChannel({
      request: request as never,
      sendXfer: (b) => sent.push(b),
      buffered: () => 0,
    });

    await expect(
      channel.upload(
        { purpose: "attachment", sessionId: "s1", name: "a.bin" },
        bytesSource(new Uint8Array(8)),
      ),
    ).rejects.toThrow(/checksum mismatch/);
    expect(request).toHaveBeenCalledWith("transfer.abort", { transfer_id: 2 });
  });
});

describe("transferChannel download", () => {
  function channelFor(size: number) {
    return new TransferChannel({
      request: (async () => ({
        transfer_id: 5,
        name: "d.bin",
        size,
      })) as never,
      sendXfer: () => undefined,
      buffered: () => 0,
    });
  }

  it("reassembles chunks and verifies the digest", async () => {
    const payload = Uint8Array.from({ length: 12 }, (_, i) => i);
    const channel = channelFor(payload.length);
    const pending = channel.download("s1", "d.bin");
    await Promise.resolve();

    channel.pushFrame(encode(XFER_CHUNK, 5, 0, payload.subarray(0, 6)));
    channel.pushFrame(encode(XFER_CHUNK, 5, 1, payload.subarray(6)));
    channel.pushFrame(encode(XFER_END, 5, 2, sha256(payload)));

    await expect(pending).resolves.toEqual({ bytes: payload, name: "d.bin" });
  });

  it("rejects a digest that does not match", async () => {
    const payload = new Uint8Array(4);
    const channel = channelFor(payload.length);
    const pending = channel.download("s1", "d.bin");
    await Promise.resolve();

    channel.pushFrame(encode(XFER_CHUNK, 5, 0, payload));
    channel.pushFrame(encode(XFER_END, 5, 1, new Uint8Array(32)));

    await expect(pending).rejects.toThrow(/checksum mismatch/);
  });

  it("rejects a chunk that arrives out of order", async () => {
    const channel = channelFor(8);
    const pending = channel.download("s1", "d.bin");
    await Promise.resolve();

    channel.pushFrame(encode(XFER_CHUNK, 5, 1, new Uint8Array(4)));

    await expect(pending).rejects.toThrow(/out of order/);
  });

  it("fails everything in flight when the socket drops", async () => {
    const channel = channelFor(8);
    const pending = channel.download("s1", "d.bin");
    await Promise.resolve();
    channel.reset();

    await expect(pending).rejects.toThrow(/connection lost/);
  });
});
