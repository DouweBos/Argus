/**
 * An account device's push key, sealed for one host (phase 3). The device
 * derives the wrapping key from its own Noise key and the host's, both pinned
 * in the signed log, so only that device could have sealed it and only that
 * host can open it — the account service just stores the blob.
 *
 * Mirrored by `ArgusKit/Account/AccountPushKey.swift`; checked against the
 * `push_key.json` fixture.
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";

const SALT = "argus-account-pushkey-v1";

function wrappingKey(
  sharedSecret: Uint8Array,
  deviceId: string,
  hostId: string,
): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      sharedSecret,
      Buffer.from(SALT, "utf-8"),
      Buffer.from(`${deviceId}\n${hostId}`, "utf-8"),
      32,
    ),
  );
}

/** What a device does; here for tests and fixtures. */
export function sealPushKey(opts: {
  deviceNoisePriv: Uint8Array;
  hostNoisePub: Uint8Array;
  deviceId: string;
  hostId: string;
  pushKey: Uint8Array;
  nonce: Uint8Array;
}): string {
  const key = wrappingKey(
    x25519.getSharedSecret(opts.deviceNoisePriv, opts.hostNoisePub),
    opts.deviceId,
    opts.hostId,
  );
  const cipher = createCipheriv("aes-256-gcm", key, opts.nonce);
  const ciphertext = Buffer.concat([
    cipher.update(opts.pushKey),
    cipher.final(),
  ]);

  return Buffer.concat([
    Buffer.from(opts.nonce),
    ciphertext,
    cipher.getAuthTag(),
  ]).toString("base64");
}

/** The device's 32-byte push key (base64), or null if it isn't one it sealed for us. */
export function openPushKey(opts: {
  hostNoisePriv: Uint8Array;
  deviceNoisePub: Uint8Array;
  deviceId: string;
  hostId: string;
  sealed: string;
}): string | null {
  try {
    const blob = Buffer.from(opts.sealed, "base64");
    if (blob.length !== 12 + 32 + 16) {
      return null;
    }
    const key = wrappingKey(
      x25519.getSharedSecret(opts.hostNoisePriv, opts.deviceNoisePub),
      opts.deviceId,
      opts.hostId,
    );
    const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(blob.length - 16));
    const plain = Buffer.concat([
      decipher.update(blob.subarray(12, blob.length - 16)),
      decipher.final(),
    ]);

    return plain.toString("base64");
  } catch {
    return null;
  }
}
