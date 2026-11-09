/**
 * An account reset (§5.8) against the in-memory service: the host never
 * follows the new epoch, it goes unlinked with a notice and drops its account
 * devices, and a link started before it noticed unlinks first.
 */

import {
  accountSas,
  generateSigningKey,
  makeEntry,
} from "@argus/remote-protocol";
import { x25519 } from "@noble/curves/ed25519.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeSecretStorage } from "../../lib/nodeSecretStorage";
import { resetHostPlatform } from "../../platform";
import { FakeAccountService } from "./fakeAccountService";
import { resetNotice } from "./reset";

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) {
      throw new Error("timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function device(id: string, name: string) {
  const sign = generateSigningKey();
  const noise = x25519.utils.randomSecretKey();

  return {
    id,
    sign,
    member: {
      id,
      role: "device" as const,
      kind: "ios" as const,
      sign_pub: sign.pub,
      noise_pub: Buffer.from(x25519.getPublicKey(noise)).toString("base64"),
      name,
      created_at: 1,
    },
  };
}

function genesis(
  accountId: string,
  epoch: number,
  d: ReturnType<typeof device>,
) {
  return makeEntry(
    { account_id: accountId, epoch, head: null },
    { id: d.id, priv: d.sign.priv },
    { type: "genesis", member: d.member },
  );
}

describe("account reset", () => {
  let home: string;
  let fake: FakeAccountService;
  const prev = {
    home: process.env.ARGUS_HOME,
    url: process.env.ARGUS_ACCOUNT_URL,
  };

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-account-"));
    process.env.ARGUS_HOME = home;
    fake = new FakeAccountService();
    process.env.ARGUS_ACCOUNT_URL = fake.baseUrl;
    vi.stubGlobal("fetch", fake.fetch);
    vi.resetModules();
    // After resetModules, so the modules under test see this platform.
    const platform = await import("../../platform");
    platform.setHostPlatform(
      platform.nodeHostPlatform({ secretStorage: nodeSecretStorage("file") }),
    );
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

  /** A phone starts the account and approves this host; the host then lets the phone in. */
  async function linkedHost() {
    const link = await import("./link");
    link.setLinkPollFloorMs(10);
    const service = await import("./service");
    const status = await import("./status");
    const disconnect = vi.fn();
    await service.startAccount({ disconnect });
    const phone = device("phone-1", "Old phone");
    fake.append([genesis(fake.accountId, 0, phone)]);
    const started = await link.startLink("cli");
    const request = fake.claim((started as { user_code: string }).user_code);
    const host = request.subject.host!;
    const head = fake.setApprover(request.id, {
      id: phone.id,
      sign_pub: phone.sign.pub,
    });
    const { commit } = accountSas({
      account_id: fake.accountId,
      epoch: 0,
      head_hash: head.hash,
      approver_sign_pub: phone.sign.pub,
      subject_sign_pub: host.sign_pub,
      subject_noise_pub: host.noise_pub,
      request_id: request.id,
    });
    await waitFor(() => status.getLinkState().kind === "awaiting_sas");
    await link.confirmLink(true);
    fake.append([
      makeEntry(
        { account_id: fake.accountId, epoch: 0, head },
        { id: phone.id, priv: phone.sign.priv },
        {
          type: "add_host",
          member: host,
          request_id: request.id,
          sas_commit: commit,
          proof: request.subject.proofs[host.id],
        },
      ),
    ]);
    await waitFor(() => status.getLinkState().kind === "linked");
    const trust = await import("./trust");
    await trust.findAccountDevice(phone.member.noise_pub);

    return { link, service, status, disconnect, phone, hostId: host.id };
  }

  it("goes unlinked with a notice and drops old-epoch devices", async () => {
    const { status, disconnect, phone, hostId } = await linkedHost();
    const fresh = device("phone-2", "New phone");
    const reset = genesis(fake.accountId, 1, fresh);
    fake.resetAccount(reset);

    const { syncLog } = await import("./lifecycle");
    const { settleReset } = await import("./reset");
    await syncLog();
    await settleReset();

    const now = status.accountStatus();
    expect(now.linked).toBe(false);
    expect(now.reset).toEqual({
      epoch: 1,
      at: JSON.parse(reset.body).ts,
      by_name: "New phone",
    });
    expect(disconnect).toHaveBeenCalledWith(phone.id);
    const { listDevices } = await import("../remote/deviceStore");
    await expect(listDevices()).resolves.toEqual([]);
    const trust = await import("./trust");
    // A fresh identity: the service never takes an old member id back.
    expect(trust.currentRecord()?.host_id).not.toBe(hostId);
    await expect(
      trust.findAccountDevice(fresh.member.noise_pub),
    ).resolves.toBeNull();
  });

  it("unlinks before linking when it hadn't noticed the reset yet", async () => {
    const { link, status } = await linkedHost();
    fake.resetAccount(genesis(fake.accountId, 1, device("phone-2", "New")));

    const started = await link.startLink("cli");

    expect(started.kind).toBe("awaiting_claim");
    expect(status.accountStatus().reset?.epoch).toBe(1);
  });

  it("keeps the notice until dismissed", async () => {
    const { status } = await linkedHost();
    fake.resetAccount(genesis(fake.accountId, 1, device("phone-2", "New")));
    const { syncLog } = await import("./lifecycle");
    const reset = await import("./reset");
    await syncLog();
    await reset.settleReset();
    expect(status.accountStatus().reset).not.toBeNull();

    const after = await reset.dismissReset();

    expect(after.reset).toBeNull();
  });
});

describe("resetNotice", () => {
  const pinned = { account_id: "acct", epoch: 2 };
  const d = device("d", "Phone");

  it("takes the founder's name and time from the genesis", () => {
    const entry = genesis("acct", 3, d);

    expect(resetNotice({ epoch: 3, genesis: entry }, pinned, 5)).toEqual({
      epoch: 3,
      at: JSON.parse(entry.body).ts,
      by_name: "Phone",
    });
  });

  it("ignores an older epoch, another account, or a genesis that doesn't match", () => {
    expect(resetNotice({ epoch: 2, genesis: null }, pinned)).toBeNull();
    expect(
      resetNotice({ epoch: 3, genesis: genesis("other", 3, d) }, pinned),
    ).toBeNull();
    expect(
      resetNotice({ epoch: 4, genesis: genesis("acct", 3, d) }, pinned),
    ).toBeNull();
  });

  it("accepts a bare epoch without naming anyone", () => {
    expect(resetNotice({ epoch: 3, genesis: null }, pinned, 9)).toEqual({
      epoch: 3,
      at: 9,
      by_name: null,
    });
  });
});
