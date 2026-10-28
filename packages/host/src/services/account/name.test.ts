/**
 * The computer-name setting against an in-memory account service: linking
 * with it, renaming on change (and later, when offline), following a rename
 * made from another device, and the list's Rename editing the same setting.
 */

import {
  entryHash,
  generateSigningKey,
  makeEntry,
} from "@argus/remote-protocol";
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

function bodies(fake: FakeAccountService) {
  return fake.entries.map((e) => JSON.parse(e.body) as Record<string, unknown>);
}

describe("computer name", () => {
  let home: string;
  let fake: FakeAccountService;
  const prev = {
    home: process.env.ARGUS_HOME,
    url: process.env.ARGUS_ACCOUNT_URL,
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-account-name-"));
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
    const name = await import("./name");
    await service.startAccount({ disconnect: vi.fn() });

    return { link, service, status, name };
  }

  /** Become the first computer of an empty account. */
  async function linkFirst(
    env: Awaited<ReturnType<typeof boot>>,
    surface: "cli" | "electron" = "cli",
  ) {
    const started = await env.link.startLink(surface);
    fake.claim((started as { user_code: string }).user_code);
    await waitFor(() => env.status.getLinkState().kind === "awaiting_first");
    await env.link.confirmLink(true);
  }

  it("defaults to the system name and validates edits", async () => {
    const env = await boot();
    const before = env.status.accountStatus();
    expect(before.name).toBe(before.system_name);

    await expect(env.name.setComputerName("  ", "settings")).rejects.toBe(
      env.name.INVALID_NAME,
    );
    await expect(
      env.name.setComputerName("a".repeat(65), "settings"),
    ).rejects.toBe(env.name.INVALID_NAME);
    await expect(
      env.name.setComputerName("line\nbreak", "settings"),
    ).rejects.toBe(env.name.INVALID_NAME);

    const set = await env.name.setComputerName("  Studio  ", "settings");
    expect(set.name).toBe("Studio");
    const reset = await env.name.setComputerName(null, "settings");
    expect(reset.name).toBe(before.system_name);
  });

  it("links as the name it was given", async () => {
    const env = await boot();
    await env.name.setComputerName("Mac mini", "settings");
    await linkFirst(env);

    expect(bodies(fake)[0]).toMatchObject({
      type: "genesis",
      member: { name: "Mac mini" },
    });
  });

  it("renames this host and its window's device on the account", async () => {
    const env = await boot();
    await linkFirst(env, "electron");
    const { host_id, device_id } = env.status.accountStatus();

    await env.name.setComputerName("Studio", "settings");

    const renames = bodies(fake).filter((b) => b.type === "rename");
    expect(renames).toEqual([
      expect.objectContaining({ member_id: host_id, name: "Studio" }),
      expect.objectContaining({ member_id: device_id, name: "Studio" }),
    ]);
    expect(env.service.listMembers().map((m) => m.name)).toEqual([
      "Studio",
      "Studio",
    ]);
  });

  it("queues a rename while offline and puts it on the account later", async () => {
    const env = await boot();
    await linkFirst(env);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    const status = await env.name.setComputerName("Attic", "settings");
    expect(status.name).toBe("Attic");
    expect(bodies(fake).some((b) => b.type === "rename")).toBe(false);

    vi.stubGlobal("fetch", fake.fetch);
    const { flushComputerName } = await import("./lifecycle");
    await flushComputerName();

    expect(bodies(fake).at(-1)).toMatchObject({
      type: "rename",
      name: "Attic",
    });
  });

  it("follows a rename made from another device", async () => {
    const phone = generateSigningKey();
    const genesis = makeEntry(
      { account_id: fake.accountId, epoch: 0, head: null },
      { id: "phone-1", priv: phone.priv },
      {
        type: "genesis",
        member: {
          id: "phone-1",
          role: "device",
          kind: "ios",
          sign_pub: phone.pub,
          noise_pub: "bm9pc2U=",
          name: "Phone",
          created_at: 1,
        },
      },
    );
    fake.append([genesis]);
    const env = await boot();
    await env.name.setComputerName("Before", "settings");
    const offer = await env.service.linkLocalBegin();
    const asPhone = (fields: Parameters<typeof makeEntry>[2]) =>
      makeEntry(
        { account_id: fake.accountId, epoch: 0, head: fake.head()! },
        { id: "phone-1", priv: phone.priv },
        fields,
      );
    fake.append([
      asPhone({
        type: "add_host",
        member: offer.host,
        request_id: "",
        sas_commit: "",
        proof: offer.proof,
      }),
    ]);
    await env.service.linkLocalFinish({
      accountId: fake.accountId,
      epoch: 0,
      genesisHash: entryHash(genesis.body),
    });
    expect(env.service.listMembers().find((m) => m.is_self)?.name).toBe(
      "Before",
    );

    fake.append([
      asPhone({ type: "rename", member_id: offer.host.id, name: "After" }),
    ]);
    const { syncLog } = await import("./lifecycle");
    await syncLog();

    expect(env.status.accountStatus().name).toBe("After");
    const count = fake.entries.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.entries).toHaveLength(count);
  });

  it("edits the setting when this computer is renamed from the list", async () => {
    const env = await boot();
    await linkFirst(env);
    const { host_id } = env.status.accountStatus();
    const members = await import("./members");

    const status = await members.renameMember(host_id!, "Cupboard");

    expect(status.name).toBe("Cupboard");
    expect(bodies(fake).at(-1)).toMatchObject({
      type: "rename",
      member_id: host_id,
      name: "Cupboard",
    });
  });
});
