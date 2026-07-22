/**
 * Noise Protocol Framework — IK pattern, `25519_ChaChaPoly_SHA256`, with an
 * optional `psk1` variant used only during device pairing.
 *
 * This is a faithful implementation of the documented Noise state machine
 * (revision 34) — no novel crypto. The same file is mirrored verbatim in the
 * RN client so both ends interoperate. Keep it dependency-light and pure.
 *
 * IK:
 *     <- s                       (pre-message: initiator knows responder static)
 *     -> e, es, s, ss [, psk]    (psk token present only in the psk1 variant)
 *     <- e, ee, se
 */

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const HASHLEN = 32;
const DHLEN = 32;
const TAGLEN = 16;
const EMPTY = new Uint8Array(0);

export interface NoiseKeypair {
  priv: Uint8Array;
  pub: Uint8Array;
}

export type NoiseRole = "initiator" | "responder";

export function generateKeypair(): NoiseKeypair {
  const priv = x25519.utils.randomSecretKey();

  return { priv, pub: x25519.getPublicKey(priv) };
}

export function publicKey(priv: Uint8Array): Uint8Array {
  return x25519.getPublicKey(priv);
}

function dh(kp: NoiseKeypair, pub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(kp.priv, pub);
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }

  return out;
}

/**
 * Noise HKDF: HMAC-based key derivation producing 2 or 3 chained outputs.
 * Matches the spec's `HKDF(chaining_key, input_key_material, num_outputs)`.
 */
function hkdf(
  chainingKey: Uint8Array,
  ikm: Uint8Array,
  num: 2 | 3,
): Uint8Array[] {
  const tempKey = hmac(sha256, chainingKey, ikm);
  const o1 = hmac(sha256, tempKey, new Uint8Array([1]));
  const o2 = hmac(sha256, tempKey, concat(o1, new Uint8Array([2])));
  if (num === 2) {
    return [o1, o2];
  }
  const o3 = hmac(sha256, tempKey, concat(o2, new Uint8Array([3])));

  return [o1, o2, o3];
}

/** ChaCha20-Poly1305 with the Noise 96-bit nonce: 4 zero bytes + 64-bit LE n. */
function nonceBytes(n: bigint): Uint8Array {
  const out = new Uint8Array(12);
  const view = new DataView(out.buffer);
  view.setBigUint64(4, n, true);

  return out;
}

/** Noise reserves nonce 2^64-1; refuse to encrypt/decrypt at or past it. */
const MAX_NONCE = 2n ** 64n - 1n;

class CipherState {
  private key: Uint8Array | null = null;
  private n = 0n;

  initializeKey(key: Uint8Array | null): void {
    this.key = key;
    this.n = 0n;
  }

  hasKey(): boolean {
    return this.key !== null;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.key) {
      return plaintext;
    }
    if (this.n >= MAX_NONCE) {
      throw new Error("noise nonce exhausted");
    }
    const ct = chacha20poly1305(this.key, nonceBytes(this.n), ad).encrypt(
      plaintext,
    );
    this.n += 1n;

    return ct;
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.key) {
      return ciphertext;
    }
    if (this.n >= MAX_NONCE) {
      throw new Error("noise nonce exhausted");
    }
    const pt = chacha20poly1305(this.key, nonceBytes(this.n), ad).decrypt(
      ciphertext,
    );
    this.n += 1n;

    return pt;
  }
}

class SymmetricState {
  private ck: Uint8Array;
  private h: Uint8Array;
  readonly cipher = new CipherState();

  constructor(protocolName: string) {
    const name = new TextEncoder().encode(protocolName);
    if (name.length <= HASHLEN) {
      const h = new Uint8Array(HASHLEN);
      h.set(name);
      this.h = h;
    } else {
      this.h = sha256(name);
    }
    this.ck = this.h.slice();
  }

  mixKey(ikm: Uint8Array): void {
    const [ck, tempK] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.cipher.initializeKey(tempK.slice(0, 32));
  }

  mixHash(data: Uint8Array): void {
    this.h = sha256(concat(this.h, data));
  }

  mixKeyAndHash(ikm: Uint8Array): void {
    const [ck, tempH, tempK] = hkdf(this.ck, ikm, 3);
    this.ck = ck;
    this.mixHash(tempH);
    this.cipher.initializeKey(tempK.slice(0, 32));
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ct = this.cipher.encryptWithAd(this.h, plaintext);
    this.mixHash(ct);

    return ct;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const pt = this.cipher.decryptWithAd(this.h, ciphertext);
    this.mixHash(ciphertext);

    return pt;
  }

  handshakeHash(): Uint8Array {
    return this.h.slice();
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf(this.ck, EMPTY, 2);
    const c1 = new CipherState();
    const c2 = new CipherState();
    c1.initializeKey(k1.slice(0, 32));
    c2.initializeKey(k2.slice(0, 32));

    return [c1, c2];
  }
}

export interface HandshakeConfig {
  role: NoiseRole;
  staticKey: NoiseKeypair;
  /** Responder's static public key — required for the initiator (IK pre-msg). */
  remoteStatic?: Uint8Array;
  /** 32-byte pre-shared key; enables the psk1 variant when present (pairing). */
  psk?: Uint8Array;
  prologue?: Uint8Array;
  /** Test/vector hook: force the ephemeral keypair instead of generating one. */
  ephemeral?: NoiseKeypair;
}

const PROTOCOL_IK = "Noise_IK_25519_ChaChaPoly_SHA256";
const PROTOCOL_IKPSK1 = "Noise_IKpsk1_25519_ChaChaPoly_SHA256";

/** Established transport: two independent, nonce-counted cipher directions. */
export class NoiseSession {
  constructor(
    private readonly send: CipherState,
    private readonly recv: CipherState,
  ) {
    // A post-split transport always has keys; a null key here would silently
    // transmit cleartext, so fail loudly instead of degrading.
    if (!send.hasKey() || !recv.hasKey()) {
      throw new Error("noise session created without transport keys");
    }
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    return this.send.encryptWithAd(EMPTY, plaintext);
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    return this.recv.decryptWithAd(EMPTY, ciphertext);
  }
}

/** One handshake direction of the two-message IK exchange. */
export class NoiseHandshake {
  private readonly sym: SymmetricState;
  private readonly initiator: boolean;
  private readonly s: NoiseKeypair;
  private readonly psk: Uint8Array | null;
  private e: NoiseKeypair | null;
  private rs: Uint8Array | null;
  private re: Uint8Array | null = null;
  private messageIndex = 0;
  private transport: { send: CipherState; recv: CipherState } | null = null;
  private hHash: Uint8Array | null = null;

  constructor(cfg: HandshakeConfig) {
    this.initiator = cfg.role === "initiator";
    this.s = cfg.staticKey;
    this.psk = cfg.psk ?? null;
    this.e = cfg.ephemeral ?? null;
    this.rs = cfg.remoteStatic ?? null;
    if (this.initiator && !this.rs) {
      throw new Error("IK initiator requires the responder's static key");
    }

    this.sym = new SymmetricState(this.psk ? PROTOCOL_IKPSK1 : PROTOCOL_IK);
    this.sym.mixHash(cfg.prologue ?? EMPTY);
    // Pre-message `<- s`: both sides mix the responder's static public key.
    const responderStatic = this.initiator ? this.rs! : this.s.pub;
    this.sym.mixHash(responderStatic);
  }

  private ephemeral(): NoiseKeypair {
    if (!this.e) {
      this.e = generateKeypair();
    }

    return this.e;
  }

  private mixDh(a: NoiseKeypair, b: Uint8Array): void {
    this.sym.mixKey(dh(a, b));
  }

  /** Tokens for message N (0-indexed): msg0 initiator→responder, msg1 back. */
  private tokens(index: number): string[] {
    if (index === 0) {
      return this.psk ? ["e", "es", "s", "ss", "psk"] : ["e", "es", "s", "ss"];
    }

    return ["e", "ee", "se"];
  }

  isComplete(): boolean {
    return this.transport !== null;
  }

  handshakeHash(): Uint8Array {
    if (!this.hHash) {
      throw new Error("handshake not complete");
    }

    return this.hHash;
  }

  /** Initiator's transmitted static, learned+pinned by the responder. */
  remoteStaticKey(): Uint8Array {
    if (!this.rs) {
      throw new Error("remote static not yet known");
    }

    return this.rs;
  }

  writeMessage(payload: Uint8Array): Uint8Array {
    const isWriter =
      (this.messageIndex === 0 && this.initiator) ||
      (this.messageIndex === 1 && !this.initiator);
    if (!isWriter) {
      throw new Error("not this side's turn to write");
    }

    let buf = new Uint8Array(0);
    for (const token of this.tokens(this.messageIndex)) {
      switch (token) {
        case "e": {
          const e = this.ephemeral();
          buf = concat(buf, e.pub);
          this.sym.mixHash(e.pub);
          if (this.psk) {
            this.sym.mixKey(e.pub);
          }
          break;
        }
        case "s": {
          buf = concat(buf, this.sym.encryptAndHash(this.s.pub));
          break;
        }
        case "ee":
          this.mixDh(this.ephemeral(), this.re!);
          break;
        case "es":
          if (this.initiator) {
            this.mixDh(this.ephemeral(), this.rs!);
          } else {
            this.mixDh(this.s, this.re!);
          }
          break;
        case "se":
          if (this.initiator) {
            this.mixDh(this.s, this.re!);
          } else {
            this.mixDh(this.ephemeral(), this.rs!);
          }
          break;
        case "ss":
          this.mixDh(this.s, this.rs!);
          break;
        case "psk":
          this.sym.mixKeyAndHash(this.psk!);
          break;
      }
    }
    buf = concat(buf, this.sym.encryptAndHash(payload));
    this.finishMessage();

    return buf;
  }

  readMessage(message: Uint8Array): Uint8Array {
    const isReader =
      (this.messageIndex === 0 && !this.initiator) ||
      (this.messageIndex === 1 && this.initiator);
    if (!isReader) {
      throw new Error("not this side's turn to read");
    }

    let rest = message;
    for (const token of this.tokens(this.messageIndex)) {
      switch (token) {
        case "e": {
          this.re = rest.slice(0, DHLEN);
          rest = rest.slice(DHLEN);
          this.sym.mixHash(this.re);
          if (this.psk) {
            this.sym.mixKey(this.re);
          }
          break;
        }
        case "s": {
          const len = this.sym.cipher.hasKey() ? DHLEN + TAGLEN : DHLEN;
          const rs = this.sym.decryptAndHash(rest.slice(0, len));
          rest = rest.slice(len);
          this.rs = rs;
          break;
        }
        case "ee":
          this.mixDh(this.ephemeral(), this.re!);
          break;
        case "es":
          if (this.initiator) {
            this.mixDh(this.ephemeral(), this.rs!);
          } else {
            this.mixDh(this.s, this.re!);
          }
          break;
        case "se":
          if (this.initiator) {
            this.mixDh(this.s, this.re!);
          } else {
            this.mixDh(this.ephemeral(), this.rs!);
          }
          break;
        case "ss":
          this.mixDh(this.s, this.rs!);
          break;
        case "psk":
          this.sym.mixKeyAndHash(this.psk!);
          break;
      }
    }
    const payload = this.sym.decryptAndHash(rest);
    this.finishMessage();

    return payload;
  }

  private finishMessage(): void {
    this.messageIndex += 1;
    if (this.messageIndex === 2) {
      const [c1, c2] = this.sym.split();
      this.hHash = this.sym.handshakeHash();
      // c1 encrypts initiator→responder; c2 the reverse.
      this.transport = this.initiator
        ? { send: c1, recv: c2 }
        : { send: c2, recv: c1 };
    }
  }

  session(): NoiseSession {
    if (!this.transport) {
      throw new Error("handshake not complete");
    }

    return new NoiseSession(this.transport.send, this.transport.recv);
  }
}
