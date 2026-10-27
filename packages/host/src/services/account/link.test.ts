/**
 * Linking a host end to end against the in-memory service: the empty-account
 * genesis, a phone approving with the SAS, a mismatched commit, gateway trust
 * for account devices, revocation via the log, and unlinking.
 */

import type { LogEntry } from "@argus/remote-protocol";
import {
  accountSas,
  entryHash,
  generateSigningKey,
  makeEntry,
  makeProof,
  verifyLog,
} from "@argus/remote-protocol";
import { x25519 } from "@noble/curves/ed25519.js";
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

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) {
      throw new Error("timed out");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function phoneKeys() {
  const sign = generateSigningKey();
  const noise = x25519.utils.randomSecretKey();

  return {
    id: "phone-1",
    sign,
    member: {
      id: "phone-1",
      role: "device" as const,
      kind: "ios" as const,
      sign_pub: sign.pub,
      noise_pub: Buffer.from(x25519.getPublicKey(noise)).toString("base64"),
      name: "Phone",
      created_at: 1,
    },
  };
}

describe("account link", () => {
  let home: string;
  let fake: FakeAccountService;
  const prev = {
    home: process.env.ARGUS_HOME,
    url: process.env.ARGUS_ACCOUNT_URL,
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-account-"));
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

  async function boot() {
    const link = await import("./link");
    link.setLinkPollFloorMs(10);
    const service = await import("./service");
    const status = await import("./status");
    const disconnect = vi.fn();
    await service.startAccount({ disconnect });

    return { link, service, status, disconnect };
  }

  function phoneGenesis() {
    const phone = phoneKeys();
    fake.append([
      makeEntry(
        { account_id: fake.accountId, epoch: 0, head: null },
        { id: phone.id, priv: phone.sign.priv },
        { type: "genesis", member: phone.member },
      ),
    ]);

    return phone;
  }

  /** The phone's half of §5.2a: approver, SAS, then the add_host entry. */
  function phoneApproves(
    phone: ReturnType<typeof phoneKeys>,
    requestId: string,
    commitOverride?: string,
  ): { sas: string; entries: LogEntry[] } {
    const request = fake.requests.get(requestId)!;
    const head = fake.setApprover(requestId, {
      id: phone.id,
      sign_pub: phone.sign.pub,
    });
    const { sas, commit } = accountSas({
      account_id: fake.accountId,
      epoch: 0,
      head_hash: head.hash,
      approver_sign_pub: phone.sign.pub,
      subject_sign_pub: request.subject.host.sign_pub,
      subject_noise_pub: request.subject.host.noise_pub,
      request_id: requestId,
    });
    const entries = [
      makeEntry(
        { account_id: fake.accountId, epoch: 0, head },
        { id: phone.id, priv: phone.sign.priv },
        {
          type: "add_host",
          member: request.subject.host,
          request_id: requestId,
          sas_commit: commitOverride ?? commit,
          proof: request.subject.proofs[request.subject.host.id],
        },
      ),
    ];

    return { sas, entries };
  }

  it("becomes the first member of an empty account", async () => {
    const { link, status } = await boot();
    const started = await link.startLink("cli");
    expect(started.kind).toBe("awaiting_claim");
    fake.claim((started as { user_code: string }).user_code);
    await waitFor(() => status.getLinkState().kind === "awaiting_first");

    await link.confirmLink(true);

    expect(status.accountStatus()).toMatchObject({ linked: true, head_seq: 0 });
    expect(JSON.parse(fake.entries[0].body)).toMatchObject({ type: "genesis" });
    await waitFor(() => fake.presence.size === 1, 5000);
    expect(fake.rejectedSignatures).toBe(0);
  });

  it("links with the phone's approval once both sides confirm the code", async () => {
    const phone = phoneGenesis();
    const { link, status } = await boot();
    const started = await link.startLink("electron");
    const request = fake.claim((started as { user_code: string }).user_code);
    const { sas, entries } = phoneApproves(phone, request.id);
    await waitFor(() => status.getLinkState().kind === "awaiting_sas");
    expect(status.getLinkState()).toEqual({
      kind: "awaiting_sas",
      sas,
      approver_name: "Phone",
    });

    await link.confirmLink(true);
    expect(fake.append(entries)).toBe(201);
    await waitFor(() => status.getLinkState().kind === "linked");

    expect(status.accountStatus()).toMatchObject({ linked: true, head_seq: 1 });
  });

  it("refuses a log whose entry carries a different code", async () => {
    const phone = phoneGenesis();
    const { link, status } = await boot();
    const started = await link.startLink("cli");
    const request = fake.claim((started as { user_code: string }).user_code);
    const { entries } = phoneApproves(phone, request.id, "00".repeat(32));
    await waitFor(() => status.getLinkState().kind === "awaiting_sas");
    await link.confirmLink(true);
    fake.append(entries);
    await waitFor(() => status.getLinkState().kind === "error");

    expect(status.accountStatus().linked).toBe(false);
  });

  it("lets live account devices in and drops them once revoked", async () => {
    const phone = phoneGenesis();
    const { link, status, disconnect } = await boot();
    const started = await link.startLink("cli");
    const request = fake.claim((started as { user_code: string }).user_code);
    const { entries } = phoneApproves(phone, request.id);
    await waitFor(() => status.getLinkState().kind === "awaiting_sas");
    await link.confirmLink(true);
    fake.append(entries);
    await waitFor(() => status.getLinkState().kind === "linked");

    const trust = await import("./trust");
    const device = await trust.findAccountDevice(phone.member.noise_pub);
    expect(device).toMatchObject({
      device_id: phone.id,
      source: "account",
      capabilities: ["monitor", "control"],
    });
    await expect(trust.findAccountDevice("bm90LWEta2V5")).resolves.toBeNull();

    const state = verifyLog(fake.entries);
    if (!state.ok) {
      throw new Error("fake log broken");
    }
    fake.append([
      makeEntry(
        { account_id: fake.accountId, epoch: 0, head: state.state.head },
        { id: phone.id, priv: phone.sign.priv },
        { type: "revoke", member_id: phone.id, reason: "lost" },
      ),
    ]);
    const { syncLog } = await import("./lifecycle");
    await syncLog();

    expect(disconnect).toHaveBeenCalledWith(phone.id);
    expect(trust.accountAllowsDevice(device!)).toBe(false);
    const { listDevices } = await import("../remote/deviceStore");
    await expect(listDevices()).resolves.toEqual([]);
  });

  it("keeps an account device out once this console revoked it", async () => {
    const phone = phoneGenesis();
    const { link, status } = await boot();
    const started = await link.startLink("cli");
    const request = fake.claim((started as { user_code: string }).user_code);
    const { entries } = phoneApproves(phone, request.id);
    await waitFor(() => status.getLinkState().kind === "awaiting_sas");
    await link.confirmLink(true);
    fake.append(entries);
    await waitFor(() => status.getLinkState().kind === "linked");

    const trust = await import("./trust");
    await expect(
      trust.findAccountDevice(phone.member.noise_pub),
    ).resolves.not.toBeNull();
    await trust.blockAccountDevice(phone.id);

    await expect(
      trust.findAccountDevice(phone.member.noise_pub),
    ).resolves.toBeNull();
  });

  it("ignores a forged entry from the service and keeps its state", async () => {
    const phone = phoneGenesis();
    const { link, status } = await boot();
    const started = await link.startLink("cli");
    const request = fake.claim((started as { user_code: string }).user_code);
    const { entries } = phoneApproves(phone, request.id);
    await waitFor(() => status.getLinkState().kind === "awaiting_sas");
    await link.confirmLink(true);
    fake.append(entries);
    await waitFor(() => status.getLinkState().kind === "linked");

    const stranger = generateSigningKey();
    const evil = { ...phoneKeys().member, id: "evil", sign_pub: stranger.pub };
    const head = fake.head()!;
    fake.entries.push(
      makeEntry(
        { account_id: fake.accountId, epoch: 0, head },
        { id: "evil", priv: stranger.priv },
        {
          type: "add_device",
          member: evil,
          request_id: "",
          sas_commit: "",
          proof: makeProof(evil, stranger.priv),
        },
      ),
    );
    const { syncLog } = await import("./lifecycle");
    await syncLog();

    expect(status.accountStatus()).toMatchObject({
      linked: true,
      head_seq: 1,
      log_error: "unknown_signer",
    });
    const trust = await import("./trust");
    await expect(trust.findAccountDevice(evil.noise_pub)).resolves.toBeNull();
  });

  it("unlinks with a signed self-revoke", async () => {
    const { link, service, status } = await boot();
    const started = await link.startLink("cli");
    fake.claim((started as { user_code: string }).user_code);
    await waitFor(() => status.getLinkState().kind === "awaiting_first");
    await link.confirmLink(true);
    const hostId = status.accountStatus().host_id;

    const after = await service.logout();

    expect(after.linked).toBe(false);
    const last = JSON.parse(fake.entries.at(-1)!.body);
    expect(last).toMatchObject({ type: "revoke", member_id: hostId });
    expect(entryHash(fake.entries.at(-1)!.body)).toBe(fake.head()!.hash);
  });
});
