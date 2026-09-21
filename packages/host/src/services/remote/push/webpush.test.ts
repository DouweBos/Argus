import type { PushConfig } from "../deviceStore";
import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { EMPTY_PUSH_CONFIG } from "../deviceStore";
import {
  encryptWebPush,
  generateVapidKeys,
  isWebPushConfigured,
  isWebPushSubscriptionDead,
  vapidAuthorization,
  type WebPushSubscription,
} from "./webpush";

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** Stand in for a browser: a P-256 keypair plus a 16-byte auth secret. */
function subscriber(): {
  auth: Buffer;
  privateKey: Buffer;
  subscription: WebPushSubscription;
} {
  const ecdh = createECDH("prime256v1");
  const publicKey = ecdh.generateKeys();
  const auth = Buffer.from("0123456789abcdef", "utf-8");

  return {
    auth,
    privateKey: ecdh.getPrivateKey(),
    subscription: {
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc123",
      p256dh: b64url(publicKey),
      auth: b64url(auth),
    },
  };
}

/**
 * The receiving half of RFC 8291, written out independently of the sender so a
 * wrong key, nonce, or padding byte fails instead of cancelling out.
 */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);

  expect(recordSize).toBe(4096);
  expect(idLength).toBe(65);

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const uaPublic = ecdh.getPublicKey();

  const expand = (prk: Buffer, info: Buffer, length: number): Buffer =>
    createHmac("sha256", prk)
      .update(Buffer.concat([info, Buffer.from([0x01])]))
      .digest()
      .subarray(0, length);

  const ikm = expand(
    createHmac("sha256", auth).update(shared).digest(),
    Buffer.concat([
      Buffer.from("WebPush: info\0", "utf-8"),
      uaPublic,
      asPublic,
    ]),
    32,
  );
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);

  // 0x02 is the last-record padding delimiter.
  expect(plaintext[plaintext.length - 1]).toBe(0x02);

  return plaintext.subarray(0, plaintext.length - 1).toString("utf-8");
}

describe("encryptWebPush", () => {
  it("produces an aes128gcm body the subscriber can decrypt", () => {
    const { auth, privateKey, subscription } = subscriber();
    const message = JSON.stringify({ title: "Argus", body: "agent finished" });

    const body = encryptWebPush(subscription, Buffer.from(message, "utf-8"));

    expect(decrypt(body, privateKey, auth)).toBe(message);
  });

  it("puts the salt and the sender's key in the header where the spec says", () => {
    const { subscription } = subscriber();
    const salt = Buffer.alloc(16, 7);
    const senderEcdh = createECDH("prime256v1");
    senderEcdh.generateKeys();

    const body = encryptWebPush(
      subscription,
      Buffer.from("hi", "utf-8"),
      salt,
      senderEcdh.getPrivateKey(),
    );

    expect(body.subarray(0, 16).equals(salt)).toBe(true);
    expect(body.subarray(21, 86).equals(senderEcdh.getPublicKey())).toBe(true);
  });

  it("derives a different key per send, so the same message differs", () => {
    const { subscription } = subscriber();
    const plaintext = Buffer.from("same message", "utf-8");

    expect(
      encryptWebPush(subscription, plaintext).equals(
        encryptWebPush(subscription, plaintext),
      ),
    ).toBe(false);
  });
});

describe("vapidAuthorization", () => {
  function config(): PushConfig {
    const keys = generateVapidKeys();

    return {
      ...EMPTY_PUSH_CONFIG,
      enabled: true,
      vapid_private_pem: keys.privatePem,
      vapid_public: keys.publicKey,
      vapid_subject: "mailto:dev@example.com",
    };
  }

  it("signs a JWT scoped to the push service origin", () => {
    const cfg = config();
    const now = 1_700_000_000_000;

    const header = vapidAuthorization(
      cfg,
      "https://updates.push.services.mozilla.com/wpush/v2/abc123",
      now,
    );

    const match = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, jwt, key] = match!;
    expect(key).toBe(cfg.vapid_public);

    const [h, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      aud: "https://updates.push.services.mozilla.com",
      exp: 1_700_000_000 + 12 * 60 * 60,
      sub: "mailto:dev@example.com",
    });

    // The key browsers get is the raw point; it must verify the signature.
    const raw = Buffer.from(cfg.vapid_public, "base64url");
    const publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: raw.subarray(1, 33).toString("base64url"),
        y: raw.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    expect(
      cryptoVerify(
        "sha256",
        Buffer.from(`${h}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("is only configured once a keypair exists", () => {
    expect(isWebPushConfigured(EMPTY_PUSH_CONFIG)).toBe(false);
    expect(isWebPushConfigured(config())).toBe(true);
    expect(isWebPushSubscriptionDead("HTTP 410")).toBe(true);
    expect(isWebPushSubscriptionDead("HTTP 429")).toBe(false);
  });
});
