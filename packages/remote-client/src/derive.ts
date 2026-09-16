/**
 * Key/identifier derivations — byte-for-byte mirror of the desktop's
 * `electron/services/remote/derive.ts`. Constants are inlined so the client
 * stays standalone. Any change here MUST match the desktop or handshakes break.
 */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const PAIRING_HKDF_INFO = "argus-pair-v1";
const SAS_DIGITS = 6;

const enc = new TextEncoder();

export function derivePairingPsk(pairingSecret: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    pairingSecret,
    new Uint8Array(0),
    enc.encode(PAIRING_HKDF_INFO),
    32,
  );
}

export function deriveSas(handshakeHash: Uint8Array): string {
  const digest = sha256(handshakeHash);
  const view = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  );
  const code = view.getUint32(0, false) % 10 ** SAS_DIGITS;

  return code.toString().padStart(SAS_DIGITS, "0");
}
