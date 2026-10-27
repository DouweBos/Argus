/**
 * The exact byte strings every account signature covers, and the codecs they
 * rely on. Mirrored byte-for-byte by the account service and the Swift client,
 * so change nothing here without changing both.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

const ENTRY_PREFIX = "argus-account-v1\n";
const PROOF_PREFIX = "argus-account-proof-v1\n";
const PRESENCE_PREFIX = "argus-account-presence-v1\n";
const REQUEST_PREFIX = "argus-account-req-v1\n";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 with padding — the only key/signature encoding on the wire. */
export function toB64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }

  return out;
}

/** Decode standard (or url-safe) base64; throws on anything else. */
export function fromB64(value: string): Uint8Array {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) {
    throw new Error("invalid base64");
  }
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j] = (acc >> bits) & 0xff;
      j += 1;
    }
  }

  return out;
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(
    sha256(typeof data === "string" ? utf8ToBytes(data) : data),
  );
}

/** `entry_hash`: what the next entry's `prev` names. */
export function entryHash(body: string): string {
  return sha256Hex(body);
}

export function entrySigningBytes(body: string): Uint8Array {
  return utf8ToBytes(ENTRY_PREFIX + body);
}

/** A member's key vouching for its own identity (proof of possession). */
export function proofSigningBytes(member: {
  id: string;
  role: string;
  sign_pub: string;
  noise_pub: string;
}): Uint8Array {
  return utf8ToBytes(
    `${PROOF_PREFIX}${member.id}\n${member.role}\n${member.sign_pub}\n${member.noise_pub}`,
  );
}

export function presenceSigningBytes(body: string): Uint8Array {
  return utf8ToBytes(PRESENCE_PREFIX + body);
}

/** What a host signs to authenticate one HTTP request to the service. */
export function requestSigningBytes(
  method: string,
  pathAndQuery: string,
  ts: number,
  body: Uint8Array | string,
): Uint8Array {
  return utf8ToBytes(
    `${REQUEST_PREFIX}${method.toUpperCase()}\n${pathAndQuery}\n${ts}\n${sha256Hex(body)}`,
  );
}

/** Ed25519 over `message`; base64 in and out. */
export function signB64(message: Uint8Array, secretKeyB64: string): string {
  return toB64(ed25519.sign(message, fromB64(secretKeyB64)));
}

/** Never throws: a malformed key or signature is just a failed verify. */
export function verifyB64(
  message: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  try {
    const sig = fromB64(signatureB64);
    const pub = fromB64(publicKeyB64);
    if (sig.length !== 64 || pub.length !== 32) {
      return false;
    }

    return ed25519.verify(sig, message, pub, { zip215: false });
  } catch {
    return false;
  }
}

/** A fresh Ed25519 signing key pair, base64. */
export function generateSigningKey(): { priv: string; pub: string } {
  const secret = ed25519.utils.randomSecretKey();

  return { priv: toB64(secret), pub: toB64(ed25519.getPublicKey(secret)) };
}

export function signingPublicKey(secretKeyB64: string): string {
  return toB64(ed25519.getPublicKey(fromB64(secretKeyB64)));
}

/** `XXXX-XXXX-XXXX` from the genesis hash, for a by-eye account check. */
export function safetyCode(genesisHash: string): string {
  const head = genesisHash.slice(0, 12).toUpperCase();

  return `${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}`;
}
