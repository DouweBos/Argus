import { hkdf as nobleHkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { deriveSas } from "./derive";
import { generateKeypair, NoiseHandshake } from "./noise";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

/** Run the two-message IK exchange, returning both established sessions. */
function handshake(opts?: { psk?: Uint8Array; initiatorRs?: Uint8Array }) {
  const iStatic = generateKeypair();
  const rStatic = generateKeypair();
  const initiator = new NoiseHandshake({
    role: "initiator",
    staticKey: iStatic,
    remoteStatic: opts?.initiatorRs ?? rStatic.pub,
    psk: opts?.psk,
  });
  const responder = new NoiseHandshake({
    role: "responder",
    staticKey: rStatic,
    psk: opts?.psk,
  });

  const msg1 = initiator.writeMessage(bytes("hello"));
  const p1 = responder.readMessage(msg1);
  const msg2 = responder.writeMessage(bytes("world"));
  const p2 = initiator.readMessage(msg2);

  return { initiator, responder, iStatic, rStatic, p1, p2 };
}

describe("noise IK", () => {
  it("completes the handshake and carries payloads both ways", () => {
    const { initiator, responder, p1, p2 } = handshake();
    expect(new TextDecoder().decode(p1)).toBe("hello");
    expect(new TextDecoder().decode(p2)).toBe("world");
    expect(initiator.isComplete()).toBe(true);
    expect(responder.isComplete()).toBe(true);
  });

  it("establishes a transport that round-trips in both directions", () => {
    const { initiator, responder } = handshake();
    const cs = initiator.session();
    const sc = responder.session();

    const ct = cs.encrypt(bytes("client->desktop"));
    expect(new TextDecoder().decode(sc.decrypt(ct))).toBe("client->desktop");

    const rt = sc.encrypt(bytes("desktop->client"));
    expect(new TextDecoder().decode(cs.decrypt(rt))).toBe("desktop->client");
  });

  it("lets the responder pin the initiator's transmitted static key", () => {
    const { responder, iStatic } = handshake();
    expect(Buffer.from(responder.remoteStaticKey())).toEqual(
      Buffer.from(iStatic.pub),
    );
  });

  it("both ends derive the same SAS", () => {
    const { initiator, responder } = handshake();
    expect(deriveSas(initiator.handshakeHash())).toBe(
      deriveSas(responder.handshakeHash()),
    );
  });

  it("rejects a tampered transport frame (AEAD)", () => {
    const { initiator, responder } = handshake();
    const ct = initiator.session().encrypt(bytes("secret"));
    ct[ct.length - 1] ^= 0xff;
    expect(() => responder.session().decrypt(ct)).toThrow();
  });

  it("fails when the initiator has the wrong responder static (impersonation)", () => {
    const wrong = generateKeypair().pub;
    expect(() => handshake({ initiatorRs: wrong })).toThrow();
  });
});

describe("noise IKpsk1 (pairing)", () => {
  it("completes when both sides share the PSK", () => {
    const psk = sha256(bytes("shared-pairing-secret"));
    const { p1, p2 } = handshake({ psk });
    expect(new TextDecoder().decode(p1)).toBe("hello");
    expect(new TextDecoder().decode(p2)).toBe("world");
  });

  it("fails the handshake when the PSK differs (MITM at pairing)", () => {
    const initiator = new NoiseHandshake({
      role: "initiator",
      staticKey: generateKeypair(),
      remoteStatic: (() => {
        const r = generateKeypair();

        return r.pub;
      })(),
      psk: sha256(bytes("attacker-guess")),
    });
    // Responder built with a different static than what the initiator targeted,
    // and a different PSK — the psk1 handshake must not decrypt msg1.
    const responder = new NoiseHandshake({
      role: "responder",
      staticKey: generateKeypair(),
      psk: sha256(bytes("real-secret")),
    });
    const msg1 = initiator.writeMessage(bytes("hello"));
    expect(() => responder.readMessage(msg1)).toThrow();
  });
});

describe("noise HKDF cross-check", () => {
  it("2-output Noise HKDF equals RFC-5869 HKDF extract+expand", () => {
    // Noise HKDF(ck, ikm, 2) == HKDF(salt=ck, ikm, "", 64) split in half.
    const ck = sha256(bytes("chaining"));
    const ikm = bytes("input-key-material");
    const o1 = hmac(sha256, hmac(sha256, ck, ikm), new Uint8Array([1]));
    const o2 = hmac(sha256, hmac(sha256, ck, ikm), new Uint8Array([...o1, 2]));
    const reference = nobleHkdf(sha256, ikm, ck, new Uint8Array(0), 64);
    expect(Buffer.from([...o1, ...o2])).toEqual(Buffer.from(reference));
  });
});
