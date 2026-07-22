/**
 * Key/identifier derivations shared by pairing and steady-state connections.
 * All pure functions over the same SHA-256 HKDF used by the Noise layer, so the
 * RN client can mirror them byte-for-byte.
 */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { PAIRING_HKDF_INFO, SAS_DIGITS } from "@argus/remote-protocol";

const enc = new TextEncoder();

/** Derive the 32-byte pairing PSK from the out-of-band QR secret. */
export function derivePairingPsk(pairingSecret: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    pairingSecret,
    new Uint8Array(0),
    enc.encode(PAIRING_HKDF_INFO),
    32,
  );
}

/**
 * Short Authentication String derived from the completed handshake hash. Both
 * ends display it; a matching code proves no MITM sits between them.
 */
export function deriveSas(handshakeHash: Uint8Array): string {
  const digest = sha256(handshakeHash);
  const view = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  );
  const modulo = 10 ** SAS_DIGITS;
  const code = Number(view.getUint32(0, false) % modulo);

  return code.toString().padStart(SAS_DIGITS, "0");
}
