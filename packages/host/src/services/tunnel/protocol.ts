/**
 * Framing for the port-forwarding channel: raw TCP bytes between a client's
 * loopback listener and a port on this host, alongside `TAG_JSON` (0x00),
 * `TAG_MEDIA` (0x01) and `TAG_XFER` (0x02).
 *
 * Layout after the tag byte:
 *
 *   [0]  u8   message type (data / close)
 *   [1]  u8   flags, reserved
 *   [2]  u16  tunnel id (little-endian, chosen by the client, per-connection)
 *   [4]  …    bytes, for `data`
 */

export const TAG_TUNNEL = 0x03;

export const TUNNEL_DATA = 0;
export const TUNNEL_CLOSE = 1;

export const TUNNEL_HEADER_BYTES = 4;

export interface TunnelMessage {
  type: number;
  tunnelId: number;
  payload: Uint8Array;
}

export function encodeTunnel(
  type: number,
  tunnelId: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const body = new Uint8Array(TUNNEL_HEADER_BYTES + payload.length);
  const view = new DataView(body.buffer);
  view.setUint8(0, type);
  view.setUint8(1, 0);
  view.setUint16(2, tunnelId & 0xffff, true);
  body.set(payload, TUNNEL_HEADER_BYTES);

  return body;
}

export function decodeTunnel(body: Uint8Array): TunnelMessage | null {
  if (body.length < TUNNEL_HEADER_BYTES) {
    return null;
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  return {
    type: view.getUint8(0),
    tunnelId: view.getUint16(2, true),
    payload: body.subarray(TUNNEL_HEADER_BYTES),
  };
}
