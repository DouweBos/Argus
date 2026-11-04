import { x25519 } from "@noble/curves/ed25519.js";
import {
  makeEntryWith,
  makeProofWith,
  proofSigningBytes,
  toB64,
  verifyB64,
  verifyLog,
} from "@argus/remote-protocol/account";
import { describe, expect, it } from "vitest";
import { memoryVaultStore } from "./vault";
import {
  deviceMember,
  dhWith,
  entrySigner,
  generateDeviceKeys,
  signWith,
  webCryptoSupported,
} from "./webKeys";

describe("web device keys", () => {
  it("is supported where WebCrypto has Ed25519 and X25519", async () => {
    expect(await webCryptoSupported()).toBe(true);
    expect(await webCryptoSupported(undefined)).toBe(true);
  });

  it("generates non-extractable private keys", async () => {
    const keys = await generateDeviceKeys("Test browser", 1);
    expect(keys.signKey.extractable).toBe(false);
    expect(keys.noiseKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", keys.signKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("pkcs8", keys.noiseKey)).rejects.toThrow();
    expect(atob(keys.signPub)).toHaveLength(32);
    expect(atob(keys.noisePub)).toHaveLength(32);
  });

  it("keeps working, and unreadable, after a round trip through the vault", async () => {
    const vaults = memoryVaultStore();
    const original = await generateDeviceKeys("Test browser", 1);
    await vaults.save({ ...(await vaults.load()), keys: original });
    const keys = (await vaults.load()).keys!;
    expect(keys.signKey.extractable).toBe(false);

    const message = new TextEncoder().encode("hello");
    const sig = await signWith(keys, message);
    expect(verifyB64(message, toB64(sig), original.signPub)).toBe(true);
  });

  it("signs proofs and log entries the shared verifier checks", async () => {
    const keys = await generateDeviceKeys("Test browser", 1);
    const member = deviceMember(keys);
    expect(member.kind).toBe("web");
    const proof = await makeProofWith(member, (m) => signWith(keys, m));
    expect(verifyB64(proofSigningBytes(member), proof, keys.signPub)).toBe(true);

    const genesis = await makeEntryWith(
      { account_id: "acct", epoch: 0, head: null, ts: 1 },
      entrySigner(keys),
      { type: "genesis", member },
    );
    // The signature checks out; a browser just may not start an account.
    expect(verifyLog([genesis])).toMatchObject({ ok: false, reason: "web_approver" });
  });

  it("agrees on the X25519 secret with a host holding a raw key", async () => {
    const keys = await generateDeviceKeys("Test browser", 1);
    const hostPriv = x25519.utils.randomSecretKey();
    const hostPub = x25519.getPublicKey(hostPriv);
    const fromBrowser = await dhWith(keys, hostPub);
    const fromHost = x25519.getSharedSecret(
      hostPriv,
      Uint8Array.from(atob(keys.noisePub), (c) => c.charCodeAt(0)),
    );
    expect(fromBrowser).toEqual(fromHost);
  });
});
