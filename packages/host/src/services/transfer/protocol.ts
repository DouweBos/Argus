/**
 * Framing for the chunked binary transfer channel.
 *
 * A third plaintext tag alongside `TAG_JSON` (0x00) and `TAG_MEDIA` (0x01), with
 * the same 12-byte header shape so the two binary channels read alike. Control
 * — open, complete, abort — stays on the JSON request/response layer; only the
 * bytes ride here.
 *
 * Layout after the tag byte:
 *
 *   [0]  u8   message type (chunk / end / abort)
 *   [1]  u8   flags, reserved
 *   [2]  u16  transfer id (little-endian, per-connection)
 *   [4]  u32  sequence number (little-endian); for `end`, the chunk count
 *   [8]  u32  reserved
 *   [12] …    chunk bytes, or the 32-byte SHA-256 digest for `end`
 */

/** Plaintext tag for a transfer message, alongside TAG_JSON / TAG_MEDIA. */
export const TAG_XFER = 0x02;

export const XFER_CHUNK = 0;
export const XFER_END = 1;
export const XFER_ABORT = 2;

export const XFER_HEADER_BYTES = 12;

/**
 * Bytes per chunk. Two orders of magnitude under the gateway's 16 MiB
 * `maxPayload`, so a chunk plus Noise overhead never approaches the frame cap,
 * and large enough that a 500 MB transfer is ~2k frames rather than 500k.
 */
export const XFER_CHUNK_BYTES = 256 * 1024;

/** SHA-256, the digest an `end` message carries. */
export const XFER_DIGEST_BYTES = 32;

export interface XferMessage {
  type: number;
  transferId: number;
  seq: number;
  payload: Uint8Array;
}

/** Build one transfer message body (the bytes after the transport's tag). */
export function encodeXfer(
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

/** Parse a transfer message body, or null when it is malformed. */
export function decodeXfer(body: Uint8Array): XferMessage | null {
  if (body.length < XFER_HEADER_BYTES) {
    return null;
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  return {
    type: view.getUint8(0),
    transferId: view.getUint16(2, true),
    seq: view.getUint32(4, true),
    payload: body.subarray(XFER_HEADER_BYTES),
  };
}
