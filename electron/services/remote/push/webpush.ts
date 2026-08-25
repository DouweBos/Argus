/**
 * Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) straight from the desktop.
 *
 * Browsers hand out a push endpoint on Mozilla's / Google's / Apple's push
 * service; anyone holding the VAPID key can post to it. Argus generates that
 * key locally and signs its own requests, so — like APNs and FCM — nothing
 * routes through an Argus server, and the push service only ever sees a blob
 * it can't read.
 */

import type { PushConfig } from "../deviceStore";
import type { PushOutcome } from "./apns";
import type { KeyObject } from "node:crypto";
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
} from "node:crypto";

export interface WebPushSubscription {
  endpoint: string;
  /** The browser's public key, base64url (uncompressed P-256 point). */
  p256dh: string;
  /** The subscription's auth secret, base64url (16 bytes). */
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
  /** Notification tag — a newer one replaces an unread older one. */
  collapseId?: string;
  /** Buttons rendered on the notification by the service worker. */
  actions?: { id: string; title: string }[];
}

/** Push services cap the record size; 4096 is the universally-accepted floor. */
const RECORD_SIZE = 4096;
/** How long the receiving push service should hold an undelivered message. */
const TTL_SECONDS = 24 * 60 * 60;
/** VAPID tokens must not exceed 24h; 12h leaves room for clock skew. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;

function b64url(bytes: Buffer | Uint8Array | string): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/** Raw uncompressed P-256 point (0x04 || x || y) from a KeyObject. */
function rawPublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" }) as { x: string; y: string };

  return Buffer.concat([
    Buffer.from([0x04]),
    fromB64url(jwk.x),
    fromB64url(jwk.y),
  ]);
}

export interface VapidKeypair {
  privatePem: string;
  publicKey: string;
}

/** Mint a fresh VAPID keypair. Rotating it invalidates every subscription. */
export function generateVapidKeys(): VapidKeypair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: b64url(rawPublicKey(publicKey)),
  };
}

export function isWebPushConfigured(config: PushConfig): boolean {
  return Boolean(config.vapid_private_pem && config.vapid_public);
}

/** HKDF as web push uses it: single-block expand, truncated to `length`. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const okm = createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest();

  return okm.subarray(0, length);
}

function keyInfo(label: string, ...parts: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from(label, "utf-8"),
    Buffer.from([0x00]),
    ...parts,
  ]);
}

/**
 * Encrypt a payload for one subscription, producing an `aes128gcm` body:
 * salt(16) ‖ rs(4) ‖ idlen(1) ‖ server public key(65) ‖ ciphertext.
 */
export function encryptWebPush(
  subscription: WebPushSubscription,
  plaintext: Buffer,
  salt: Buffer = randomBytes(16),
  /** Fixed ephemeral key — tests only; production always uses a fresh one. */
  serverPrivate?: Buffer,
): Buffer {
  const clientPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);

  const ecdh = createECDH("prime256v1");
  let serverPublic: Buffer;
  if (serverPrivate) {
    ecdh.setPrivateKey(serverPrivate);
    serverPublic = ecdh.getPublicKey();
  } else {
    serverPublic = ecdh.generateKeys();
  }
  const sharedSecret = ecdh.computeSecret(clientPublic);

  // RFC 8291 §3.3: the auth secret salts the shared secret before the real HKDF.
  const ikm = hkdf(
    authSecret,
    sharedSecret,
    keyInfo("WebPush: info", clientPublic, serverPublic),
    32,
  );
  const cek = hkdf(salt, ikm, keyInfo("Content-Encoding: aes128gcm"), 16);
  const nonce = hkdf(salt, ikm, keyInfo("Content-Encoding: nonce"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 is the last-record padding delimiter.
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublic.length, 20);

  return Buffer.concat([header, serverPublic, ciphertext]);
}

/** Sign the VAPID JWT authorising this desktop against one push service. */
export function vapidAuthorization(
  config: PushConfig,
  endpoint: string,
  now: number,
): string {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(now / 1000) + VAPID_TTL_SECONDS,
      sub: config.vapid_subject || "mailto:argus@localhost",
    }),
  );
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey({ key: config.vapid_private_pem, format: "pem" }),
    dsaEncoding: "ieee-p1363",
  });

  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${config.vapid_public}`;
}

export async function sendWebPush(
  config: PushConfig,
  subscription: WebPushSubscription,
  payload: WebPushPayload,
  now: number,
): Promise<PushOutcome> {
  if (!isWebPushConfigured(config)) {
    return {
      ok: false,
      retryable: false,
      reason: "Web Push is not configured",
    };
  }

  let body: Buffer;
  let authorization: string;
  try {
    body = encryptWebPush(
      subscription,
      Buffer.from(
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          tag: payload.collapseId,
          actions: payload.actions ?? [],
          data: payload.data,
        }),
        "utf-8",
      ),
    );
    authorization = vapidAuthorization(config, subscription.endpoint, now);
  } catch (err) {
    return { ok: false, retryable: false, reason: (err as Error).message };
  }

  let res: Response;
  try {
    res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL_SECONDS),
        urgency: "high",
      },
      body: new Uint8Array(body),
    });
  } catch (err) {
    return { ok: false, retryable: true, reason: (err as Error).message };
  }

  if (res.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    retryable: res.status >= 500 || res.status === 429,
    reason: `HTTP ${res.status}`,
  };
}

/** Statuses that mean the browser dropped this subscription for good. */
export function isWebPushSubscriptionDead(reason: string): boolean {
  return reason === "HTTP 404" || reason === "HTTP 410";
}
