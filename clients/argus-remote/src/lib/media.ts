/**
 * Binary media framing shared with the desktop gateway. The payload is raw
 * H.264 (avcC description + access units); decoding happens in the native
 * `argus-video` module, so this layer only parses the envelope.
 */

export type MediaMessage =
  | {
      kind: "config";
      streamId: number;
      codec: string;
      codedWidth: number;
      codedHeight: number;
      description: Uint8Array;
    }
  | {
      kind: "frame";
      streamId: number;
      keyFrame: boolean;
      timestamp: number;
      data: Uint8Array;
    };

/** Parse a media message (the bytes after the transport's media tag). */
export function parseMediaMessage(bytes: Uint8Array): MediaMessage | null {
  if (bytes.length < 12) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const msgType = view.getUint8(0);
  const flags = view.getUint8(1);
  const streamId = view.getUint16(2, true);
  const timestamp = view.getFloat64(4, true);

  if (msgType === 0) {
    // config: [codedW u16][codedH u16][codecLen u8][codec][description]
    if (bytes.length < 17) {
      return null;
    }
    const codecLen = view.getUint8(16);

    return {
      kind: "config",
      streamId,
      codedWidth: view.getUint16(12, true),
      codedHeight: view.getUint16(14, true),
      codec: decodeAscii(bytes.subarray(17, 17 + codecLen)),
      description: bytes.slice(17 + codecLen),
    };
  }

  return {
    kind: "frame",
    streamId,
    keyFrame: (flags & 1) === 1,
    timestamp,
    data: bytes.slice(12),
  };
}

/** Hermes has no TextDecoder; codec strings are ASCII ("avc1.640028"). */
function decodeAscii(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += String.fromCharCode(b);
  }

  return out;
}
