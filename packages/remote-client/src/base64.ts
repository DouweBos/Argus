/** base64 / base64url / hex helpers that work in RN (no Buffer) and on web. */

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out +=
      i + 1 < bytes.length ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : "=";
  }

  return out;
}

export function fromBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }

  return out.subarray(0, o);
}

export function fromBase64Url(input: string): Uint8Array {
  return fromBase64(input.replace(/-/g, "+").replace(/_/g, "/"));
}

export function toUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function fromUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
