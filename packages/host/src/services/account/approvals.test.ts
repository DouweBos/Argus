/**
 * Device approval on a linked host (§5.4, §5.8): console approval of a
 * device's join, the first handshake of a device approved elsewhere, removals
 * handed over by `account.sync`, and removing or renaming members.
 */

import type { DeviceMember, LogEntry } from "@argus/remote-protocol";
import {
  accountSas,
  admitsMember,
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
import { nodeSecretStorage } from "../../lib/nodeSecretStorage";
import { resetHostPlatform } from "../../platform";
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

function deviceKeys(id: string, name: string, kind: DeviceMember["kind"]) {
  const sign = generateSigningKey();
  const noise = x25519.utils.randomSecretKey();
  const member: DeviceMember = {
    id,
    role: "device",
    kind,
    sign_pub: sign.pub,
    noise_pub: Buffer.from(x25519.getPublicKey(noise)).toString("base64"),
    name,
    created_at: 1,
  };

  return { id, sign, member, proof: makeProof(member, sign.priv) };
}

type Device = ReturnType<typeof deviceKeys>;

describe("account approvals", () => {
  let home: string;
  let fake: FakeAccountService;
  const prev = {
    home: process.env.ARGUS_HOME,
    url: process.env.ARGUS_ACCOUNT_URL,
  };

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-approvals-"));
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

  /** A phone writes `fields` on the fake service's head. */
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

  /** Phone genesis, then this host linked from `surface` with the phone's approval. */
  async function linkedHost(surface: "cli" | "electron") {
    const phone = deviceKeys("phone-1", "Phone", "ios");
    fake.append([
      phoneWrites(phone, { type: "genesis", member: phone.member }),
    ]);
    const link = await import("./link");
    link.setLinkPollFloorMs(10);
    const service = await import("./service");
    const status = await import("./status");
    const disconnect = vi.fn();
    await service.startAccount({ disconnect });

    const started = await link.startLink(surface);
    const request = fake.claim((started as { user_code: string }).user_code);
    const head = fake.setApprover(request.id, {
      id: phone.id,
      sign_pub: phone.sign.pub,
    });
    const host = request.subject.host!;
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
    const entries = [
      phoneWrites(phone, {
        type: "add_host",
        member: host,
        request_id: request.id,
        sas_commit: commit,
        proof: request.subject.proofs[host.id],
      }),
    ];
    const window = request.subject.device;
    if (window) {
      entries.push(
        makeEntry(
          {
            account_id: fake.accountId,
            epoch: 0,
            head: { seq: head.seq + 1, hash: entryHash(entries[0].body) },
          },
          { id: phone.id, priv: phone.sign.priv },
          {
            type: "add_device",
            member: window,
            request_id: request.id,
            sas_commit: commit,
            proof: request.subject.proofs[window.id],
          },
        ),
      );
    }
    expect(fake.append(entries)).toBe(201);
    await waitFor(() => status.getLinkState().kind === "linked");

    return { phone, status, disconnect, service };
  }

  /** The phone puts `device` on the account without the host hearing of it. */
  function phoneAdds(phone: Device, device: Device): void {
    expect(
      fake.append([
        phoneWrites(phone, {
          type: "add_device",
          member: device.member,
          request_id: "",
          sas_commit: "",
          proof: device.proof,
        }),
      ]),
    ).toBe(201);
  }

  it("approves a device's join from the console with the code both show", async () => {
    const { status } = await linkedHost("cli");
    const tablet = deviceKeys("tablet-1", "Tablet", "ios");
    const request = fake.addDeviceJoin(tablet.member, tablet.proof);
    const approvals = await import("./approvals");

    const listed = await approvals.listRequests();
    expect(listed).toMatchObject([
      {
        request_id: request.id,
        kind: "device",
        subject_name: "Tablet",
        subject_role: "device",
        subject_kind: "ios",
      },
    ]);

    const asking = await approvals.approveJoin(request.id);
    const hostSignPub = (await import("./trust")).currentRecord()!
      .host_sign_pub;
    const expected = accountSas({
      account_id: fake.accountId,
      epoch: 0,
      head_hash: fake.head()!.hash,
      approver_sign_pub: hostSignPub,
      subject_sign_pub: tablet.member.sign_pub,
      subject_noise_pub: tablet.member.noise_pub,
      request_id: request.id,
    });
    expect(asking).toEqual({
      kind: "awaiting_sas",
      request_id: request.id,
      sas: expected.sas,
      subject_name: "Tablet",
      subject_role: "device",
    });

    await expect(approvals.confirmJoin(true)).resolves.toEqual({
      kind: "approved",
      request_id: request.id,
      subject_role: "device",
    });
    const last = JSON.parse(fake.entries.at(-1)!.body);
    expect(last).toMatchObject({
      type: "add_device",
      signer: status.accountStatus().host_id,
      request_id: request.id,
      sas_commit: expected.commit,
    });
    expect(fake.requests.get(request.id)?.status).toBe("approved");
    const log = verifyLog(fake.entries);
    expect(
      log.ok &&
        admitsMember(log.state, tablet.id, {
          request_id: request.id,
          sas_commit: expected.commit,
        }),
    ).toBe(true);
    const trust = await import("./trust");
    await expect(
      trust.findAccountDevice(tablet.member.noise_pub),
    ).resolves.toMatchObject({ device_id: tablet.id, source: "account" });
  });

  it("hides and refuses a join whose proof doesn't check out", async () => {
    await linkedHost("cli");
    const tablet = deviceKeys("tablet-1", "Tablet", "ios");
    const other = generateSigningKey();
    const request = fake.addDeviceJoin(
      tablet.member,
      makeProof(tablet.member, other.priv),
    );
    const approvals = await import("./approvals");

    await expect(approvals.listRequests()).resolves.toEqual([]);
    await expect(approvals.approveJoin(request.id)).rejects.toMatch(
      /don't check out/,
    );
  });

  it("lets a device approved elsewhere in on its first handshake", async () => {
    const { phone } = await linkedHost("cli");
    const tablet = deviceKeys("tablet-1", "Tablet", "ios");
    phoneAdds(phone, tablet);
    const lifecycle = await import("./lifecycle");

    await expect(
      lifecycle.findAccountDeviceFresh(tablet.member.noise_pub),
    ).resolves.toMatchObject({ device_id: tablet.id });
    // A stranger's key straight after doesn't make it ask the service again.
    const before = fake.entries.length;
    await expect(
      lifecycle.findAccountDeviceFresh("bm90LWEta2V5"),
    ).resolves.toBeNull();
    expect(fake.entries).toHaveLength(before);
  });

  it("applies a removal a device hands over while the service withholds it", async () => {
    const { phone, status, disconnect } = await linkedHost("cli");
    const tablet = deviceKeys("tablet-1", "Tablet", "ios");
    phoneAdds(phone, tablet);
    const lifecycle = await import("./lifecycle");
    await lifecycle.syncLog();
    const trust = await import("./trust");
    await trust.findAccountDevice(tablet.member.noise_pub);

    // Signed by the phone, but never appended to the service.
    const revoke = phoneWrites(phone, {
      type: "revoke",
      member_id: tablet.id,
      reason: "lost",
    });
    const already = fake.entries.slice(-1);

    await expect(
      lifecycle.applyPushedEntries(0, [...already, revoke]),
    ).resolves.toEqual({ head_seq: fake.entries.length, applied: 1 });
    expect(disconnect).toHaveBeenCalledWith(tablet.id);
    await expect(
      trust.findAccountDevice(tablet.member.noise_pub),
    ).resolves.toBeNull();

    // Nothing new, or an entry from no one it knows, changes nothing.
    await expect(lifecycle.applyPushedEntries(0, [revoke])).resolves.toEqual({
      head_seq: fake.entries.length,
      applied: 0,
    });
    const stranger = deviceKeys("evil", "Evil", "ios");
    const forged = makeEntry(
      {
        account_id: fake.accountId,
        epoch: 0,
        head: { seq: fake.entries.length, hash: entryHash(revoke.body) },
      },
      { id: stranger.id, priv: stranger.sign.priv },
      { type: "rename", member_id: phone.id, name: "Owned" },
    );
    await expect(lifecycle.applyPushedEntries(0, [forged])).resolves.toEqual({
      head_seq: fake.entries.length,
      applied: 0,
    });
    expect(status.accountStatus().log_error).toBe("unknown_signer");
  });

  it("removes and renames members with the window's device", async () => {
    const { phone, status } = await linkedHost("electron");
    const tablet = deviceKeys("tablet-1", "Tablet", "ios");
    phoneAdds(phone, tablet);
    await (await import("./lifecycle")).syncLog();
    const deviceId = status.accountStatus().device_id;
    expect(deviceId).toBeTruthy();
    const members = await import("./members");

    await members.revokeMember(tablet.id);
    expect(JSON.parse(fake.entries.at(-1)!.body)).toMatchObject({
      type: "revoke",
      member_id: tablet.id,
      signer: deviceId,
    });

    const hostId = status.accountStatus().host_id;
    await members.renameMember(hostId!, "Mac mini");
    expect(JSON.parse(fake.entries.at(-2)!.body)).toMatchObject({
      type: "rename",
      member_id: hostId,
      signer: hostId,
      name: "Mac mini",
    });
    await members.renameMember(phone.id, "Kitchen");
    expect(JSON.parse(fake.entries.at(-1)!.body)).toMatchObject({
      type: "rename",
      member_id: phone.id,
      signer: deviceId,
      name: "Kitchen",
    });
    await expect(members.renameMember(phone.id, "")).rejects.toMatch(/1–64/);
    expect(status.accountStatus().head_seq).toBe(fake.entries.length - 1);
  });

  it("won't remove others without a window device", async () => {
    const { phone } = await linkedHost("cli");
    const members = await import("./members");

    await expect(members.revokeMember(phone.id)).rejects.toMatch(
      /can only remove itself/,
    );
  });
});
