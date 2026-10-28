import { x25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { generateKeypair, NoiseHandshake } from "./noise";

describe("noise handshake with an external static key", () => {
  it("interoperates with a responder holding a raw key", () => {
    const device = generateKeypair();
    const host = generateKeypair();
    // Stands in for a non-extractable WebCrypto key: only DH is exposed.
    const external = {
      pub: device.pub,
      dh: (remote: Uint8Array) => x25519.getSharedSecret(device.priv, remote),
    };
    const initiator = new NoiseHandshake({
      role: "initiator",
      staticKey: external,
      remoteStatic: host.pub,
    });
    const responder = new NoiseHandshake({
      role: "responder",
      staticKey: host,
    });

    responder.readMessage(initiator.writeMessage(new Uint8Array(0)));
    initiator.readMessage(responder.writeMessage(new Uint8Array(0)));

    expect(responder.remoteStaticKey()).toEqual(device.pub);
    const sealed = initiator.session().encrypt(new Uint8Array([1, 2, 3]));
    expect(responder.session().decrypt(sealed)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
