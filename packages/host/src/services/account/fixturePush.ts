/** The `push_key.json` vector: a push key one device sealed for one host. */

import { x25519 } from "@noble/curves/ed25519.js";
import { sealPushKey } from "./pushKey";

const fill = (byte: number, length = 32) => new Uint8Array(length).fill(byte);

export function pushKeyVector() {
  const deviceNoisePriv = fill(0x11);
  const hostNoisePriv = fill(0x22);
  const pushKey = fill(0x33);
  const nonce = fill(0x44, 12);
  const deviceId = "00000000-0000-4000-8000-000000000001";
  const hostId = "00000000-0000-4000-8000-000000000002";
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

  return {
    device_id: deviceId,
    host_id: hostId,
    device_noise_priv: b64(deviceNoisePriv),
    device_noise_pub: b64(x25519.getPublicKey(deviceNoisePriv)),
    host_noise_priv: b64(hostNoisePriv),
    host_noise_pub: b64(x25519.getPublicKey(hostNoisePriv)),
    push_key: b64(pushKey),
    nonce: b64(nonce),
    sealed: sealPushKey({
      deviceNoisePriv,
      hostNoisePub: x25519.getPublicKey(hostNoisePriv),
      deviceId,
      hostId,
      pushKey,
      nonce,
    }),
  };
}
