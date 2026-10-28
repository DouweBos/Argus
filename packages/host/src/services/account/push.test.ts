/**
 * Push through the account (phase 3): the host opens push keys only when the
 * device's own Noise key sealed them, pushes to account devices it never met,
 * and doesn't double up on a phone it already holds a registration for.
 */

import type { DeviceMember, LogEntry } from "@argus/remote-protocol";
import {
  generateSigningKey,
  makeEntry,
  makeProof,
  verifyLog,
} from "@argus/remote-protocol";
import { x25519 } from "@noble/curves/ed25519.js";
import { createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nodeHostPlatform,
  resetHostPlatform,
  setHostPlatform,
} from "../../platform";
import { FakeAccountService } from "./fakeAccountService";
import { openPushKey, sealPushKey } from "./pushKey";

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      import.meta.dirname,
      "../../../../remote-protocol/src/account/fixtures/push_key.json",
    ),
    "utf-8",
  ),
) as Record<string, string>;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const unb64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

function deviceKeys(id: string, name: string) {
  const sign = generateSigningKey();
  const noisePriv = x25519.utils.randomSecretKey();
  const member: DeviceMember = {
    id,
    role: "device",
    kind: "ios",
    sign_pub: sign.pub,
    noise_pub: b64(x25519.getPublicKey(noisePriv)),
    name,
    created_at: 1,
  };

  return { id, sign, noisePriv, member, proof: makeProof(member, sign.priv) };
}

type Device = ReturnType<typeof deviceKeys>;

function openNotification(pushKey: string, sealed: string): unknown {
  const blob = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(pushKey, "base64"),
    blob.subarray(0, 12),
  );
  decipher.setAuthTag(blob.subarray(blob.length - 16));

  return JSON.parse(
    Buffer.concat([
      decipher.update(blob.subarray(12, blob.length - 16)),
      decipher.final(),
    ]).toString("utf-8"),
  );
}

describe("push key sealing", () => {
  it("opens the shared fixture and nothing sealed for another host", () => {
    const opened = openPushKey({
      hostNoisePriv: unb64(fixture.host_noise_priv),
      deviceNoisePub: unb64(fixture.device_noise_pub),
      deviceId: fixture.device_id,
      hostId: fixture.host_id,
      sealed: fixture.sealed,
    });
    expect(opened).toBe(fixture.push_key);
    expect(
      openPushKey({
        hostNoisePriv: unb64(fixture.host_noise_priv),
        deviceNoisePub: unb64(fixture.device_noise_pub),
        deviceId: fixture.device_id,
        hostId: "00000000-0000-4000-8000-000000000003",
        sealed: fixture.sealed,
      }),
    ).toBeNull();
  });
});

describe("account push", () => {
  let home: string;
  let fake: FakeAccountService;
  const prev = {
    home: process.env.ARGUS_HOME,
    url: process.env.ARGUS_ACCOUNT_URL,
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-account-push-"));
    process.env.ARGUS_HOME = home;
    fake = new FakeAccountService();
    process.env.ARGUS_ACCOUNT_URL = fake.baseUrl;
    vi.stubGlobal("fetch", fake.fetch);
    vi.resetModules();
    setHostPlatform(nodeHostPlatform());
  });

  afterEach(async () => {
    const { stopAccount } = await import("./service");
    stopAccount();
    vi.unstubAllGlobals();
    process.env.ARGUS_HOME = prev.home;
    process.env.ARGUS_ACCOUNT_URL = prev.url;
    resetHostPlatform();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function phoneWrites(
    phone: Device,
    fields: Record<string, unknown> & { type: string },
  ): LogEntry {
    return makeEntry(
      { account_id: fake.accountId, epoch: 0, head: fake.head() },
      { id: phone.id, priv: phone.sign.priv },
      fields,
    );
  }

  /** A phone's account with this host linked locally, plus a second phone. */
  async function linked() {
    const phone = deviceKeys("00000000-0000-4000-8000-0000000000a1", "Phone");
    const tablet = deviceKeys("00000000-0000-4000-8000-0000000000a2", "Tablet");
    fake.append([
      phoneWrites(phone, { type: "genesis", member: phone.member }),
    ]);
    const service = await import("./service");
    await service.startAccount({ disconnect: vi.fn() });
    const offer = await service.linkLocalBegin();
    for (const fields of [
      { type: "add_host", member: offer.host, proof: offer.proof },
      { type: "add_device", member: tablet.member, proof: tablet.proof },
    ]) {
      fake.append([
        phoneWrites(phone, { ...fields, request_id: "", sas_commit: "" }),
      ]);
    }
    const state = verifyLog(fake.entries).state!;
    await service.linkLocalFinish({
      accountId: fake.accountId,
      epoch: 0,
      genesisHash: state.genesis_hash,
    });
    const deviceStore = await import("../remote/deviceStore");
    await deviceStore.savePushConfig({ enabled: true });

    return { phone, tablet, host: offer.host };
  }

  function grant(device: Device, hostId: string, hostNoisePub: string) {
    const pushKey = randomBytes(32);
    const sealed = sealPushKey({
      deviceNoisePriv: device.noisePriv,
      hostNoisePub: unb64(hostNoisePub),
      deviceId: device.id,
      hostId,
      pushKey,
      nonce: randomBytes(12),
    });

    return {
      pushKey: b64(pushKey),
      row: {
        device_id: device.id,
        service: "apns" as const,
        environment: "sandbox" as const,
        sealed,
      },
    };
  }

  it("pushes a sealed notification to an account device that never connected", async () => {
    const { phone, host } = await linked();
    const phoneGrant = grant(phone, host.id, host.noise_pub);
    fake.pushKeys.set(host.id, [phoneGrant.row]);

    const push = await import("./push");
    await expect(push.accountPushTargets()).resolves.toEqual([
      expect.objectContaining({
        device_id: phone.id,
        push_key: phoneGrant.pushKey,
      }),
    ]);

    const { dispatchRemotePush } = await import("../remote/push/dispatch");
    dispatchRemotePush({
      agent_id: "a1",
      session_id: null,
      tool_use_id: null,
      kind: "finished",
      title: "Done",
      body: "The agent finished.",
      actions: [],
    });
    await vi.waitFor(() => expect(fake.pushSent).toHaveLength(1));
    const sent = fake.pushSent[0];
    expect(sent).toMatchObject({ host_id: host.id, device_id: phone.id });
    expect(sent.collapse_id).toBeTruthy();
    expect(openNotification(phoneGrant.pushKey, sent.sealed)).toMatchObject({
      title: "Done",
      body: "The agent finished.",
    });
  });

  it("ignores a key the device didn't seal, and a device the log removed", async () => {
    const { phone, tablet, host } = await linked();
    const forged = grant(
      deviceKeys(phone.id, "Impostor"),
      host.id,
      host.noise_pub,
    );
    fake.pushKeys.set(host.id, [
      forged.row,
      grant(tablet, host.id, host.noise_pub).row,
    ]);
    const push = await import("./push");
    expect((await push.accountPushTargets()).map((t) => t.device_id)).toEqual([
      tablet.id,
    ]);

    fake.append([
      phoneWrites(phone, {
        type: "revoke",
        member_id: tablet.id,
        reason: "removed",
      }),
    ]);
    const { syncLog } = await import("./lifecycle");
    await syncLog();
    await expect(push.accountPushTargets()).resolves.toEqual([]);
  });

  it("doesn't push twice to a phone this host already reaches by its pairing", async () => {
    const { phone, host } = await linked();
    const phoneGrant = grant(phone, host.id, host.noise_pub);
    fake.pushKeys.set(host.id, [phoneGrant.row]);
    const push = await import("./push");
    const { accountTargetsToPush } = await import("../remote/push/dispatch");
    const targets = await push.accountPushTargets();
    const paired = {
      device_id: "paired-1",
      label: "Phone (QR)",
      dev_static_pub: b64(randomBytes(32)),
      capabilities: [],
      created_at: 1,
      last_seen: null,
      push: {
        service: "apns" as const,
        token: "t",
        push_key: phoneGrant.pushKey,
        auth_key: b64(randomBytes(32)),
        updated_at: 1,
      },
    };
    expect(accountTargetsToPush(targets, [paired], new Set())).toEqual([]);
    expect(accountTargetsToPush(targets, [], new Set([phone.id]))).toEqual([]);
    expect(accountTargetsToPush(targets, [], new Set())).toHaveLength(1);
  });
});
