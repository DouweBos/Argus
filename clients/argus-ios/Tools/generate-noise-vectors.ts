import { NoiseHandshake, type NoiseKeypair } from "../../argus-remote/src/crypto/noise.ts";
import { derivePairingPsk, deriveSas } from "../../argus-remote/src/crypto/derive.ts";
import { x25519 } from "@noble/curves/ed25519.js";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
// Deterministic keys: byte-filled scalars, so the vector is reproducible.
const kp = (fill: number): NoiseKeypair => {
  const priv = new Uint8Array(32).fill(fill);
  return { priv, pub: x25519.getPublicKey(priv) };
};

function run(usePsk: boolean) {
  const iStatic = kp(1), rStatic = kp(2), iEph = kp(3), rEph = kp(4);
  const psk = usePsk ? derivePairingPsk(new Uint8Array(32).fill(9)) : undefined;

  const ini = new NoiseHandshake({ role: "initiator", staticKey: iStatic, remoteStatic: rStatic.pub, psk, ephemeral: iEph });
  const res = new NoiseHandshake({ role: "responder", staticKey: rStatic, psk, ephemeral: rEph });

  const msg0 = ini.writeMessage(new Uint8Array(0));
  const p0 = res.readMessage(msg0);
  const msg1 = res.writeMessage(new Uint8Array(0));
  const p1 = ini.readMessage(msg1);

  const is = ini.session(), rs = res.session();
  const ct1 = is.encrypt(new TextEncoder().encode("hello from initiator"));
  const pt1 = rs.decrypt(ct1);
  const ct2 = rs.encrypt(new TextEncoder().encode("and back again"));
  const pt2 = is.decrypt(ct2);
  // Second frame in the same direction proves the nonce counter advances.
  const ct3 = is.encrypt(new TextEncoder().encode("third"));

  return {
    psk: psk ? b64(psk) : null,
    iStaticPriv: b64(iStatic.priv), iStaticPub: b64(iStatic.pub),
    rStaticPriv: b64(rStatic.priv), rStaticPub: b64(rStatic.pub),
    iEphPriv: b64(iEph.priv), rEphPriv: b64(rEph.priv),
    msg0: b64(msg0), msg1: b64(msg1),
    payload0Len: p0.length, payload1Len: p1.length,
    handshakeHash: b64(ini.handshakeHash()),
    responderHandshakeHash: b64(res.handshakeHash()),
    sas: deriveSas(ini.handshakeHash()),
    ct1: b64(ct1), pt1: new TextDecoder().decode(pt1),
    ct2: b64(ct2), pt2: new TextDecoder().decode(pt2),
    ct3: b64(ct3),
    remoteStaticSeenByResponder: b64(res.remoteStaticKey()),
  };
}

console.log(JSON.stringify({
  ik: run(false),
  ikpsk1: run(true),
  pairingPsk: b64(derivePairingPsk(new Uint8Array(32).fill(9))),
  sasOfZeros: deriveSas(new Uint8Array(32)),
}, null, 2));
