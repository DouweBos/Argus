import { sha256Hex } from "@argus/remote-protocol/account";
import { describe, expect, it } from "vitest";
import { FakeAccountService, miniKeys } from "./fakeAccountService";
import {
  confirmApprovedJoin,
  confirmJoinCode,
  pollJoin,
  rejectApprovedJoin,
} from "./join";
import { AccountSession } from "./session";
import { memoryVaultStore, type VaultStore } from "./vault";
import { generateDeviceKeys } from "./webKeys";

const TUNNEL = {
  kind: "cloudflare" as const,
  url: "wss://argus-0123456789abcdef.houwert.dev",
  priority: 2,
};
const LAN = { kind: "lan" as const, url: "ws://10.0.0.2:47615", priority: 0 };

function session(fake: FakeAccountService, vaults: VaultStore = memoryVaultStore()) {
  let signedOut = false;

  return new AccountSession({
    client: fake,
    vaults,
    auth: {
      isSignedIn: () => !signedOut,
      token: async () => "token",
      signOut: async () => {
        signedOut = true;
      },
    },
    defaultName: () => "Test browser",
    generateKeys: (name, now) => generateDeviceKeys(name, now),
    now: () => 5_000,
    joinPollMs: 0,
  });
}

function onlyRequest(fake: FakeAccountService): string {
  expect(fake.requests.size).toBe(1);

  return [...fake.requests.keys()][0];
}

describe("joining an account from the browser", () => {
  it("asks, compares the code, and adopts the log that adds it", async () => {
    const fake = new FakeAccountService().seed();
    fake.publish([LAN, TUNNEL], 100, 4_000);
    const s = session(fake);
    await s.start();
    expect(s.phase).toBe("awaitingApproval");
    expect(s.join.kind).toBe("waiting");

    const requestId = onlyRequest(fake);
    const member = fake.requests.get(requestId)!.member;
    expect(member.kind).toBe("web");
    const { sas, commit } = fake.approve(requestId);
    await pollJoin(s);
    expect(s.join).toEqual({ kind: "compare", sas, approverName: "Phone" });

    await confirmJoinCode(s);
    expect(s.join).toEqual({ kind: "confirmed", approverName: "Phone" });
    fake.complete(requestId, commit, fake.proofs.get(requestId)!);
    await pollJoin(s);

    expect(s.phase).toBe("ready");
    expect(s.vault.root?.account_id).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(s.vault.pendingJoin).toBeNull();
    // Only the tunnel: an https page can't open ws:// to the LAN.
    expect(s.computers).toMatchObject([{ id: miniKeys.id, routes: [TUNNEL] }]);
    const creds = s.credentialsFor(s.computers[0])!;
    expect(creds.url).toBe(TUNNEL.url);
    expect(creds.hostPubB64).toBe(miniKeys.noise_pub);
    expect(creds.staticKey?.pub).toHaveLength(32);
  });

  it("refuses an approval that carries a different code", async () => {
    const fake = new FakeAccountService().seed();
    const s = session(fake);
    await s.start();
    const requestId = onlyRequest(fake);
    fake.approve(requestId);
    await pollJoin(s);
    await confirmJoinCode(s);
    fake.complete(requestId, "0".repeat(64), fake.proofs.get(requestId)!);
    await pollJoin(s);

    expect(s.phase).toBe("awaitingApproval");
    expect(s.join.kind).toBe("failed");
    expect(s.vault.root).toBeNull();
  });

  it("resumes its open request after a reload instead of filing another", async () => {
    const fake = new FakeAccountService().seed();
    const vaults = memoryVaultStore();
    await session(fake, vaults).start();
    const requestId = onlyRequest(fake);

    const reloaded = session(fake, vaults);
    await reloaded.start();
    expect(reloaded.join.kind).toBe("waiting");
    expect(reloaded.pendingJoin?.requestId).toBe(requestId);
    expect(fake.requests.size).toBe(1);
  });

  it("keeps a confirmed code across a reload and finishes with it", async () => {
    const fake = new FakeAccountService().seed();
    const vaults = memoryVaultStore();
    const first = session(fake, vaults);
    await first.start();
    const requestId = onlyRequest(fake);
    const { commit } = fake.approve(requestId);
    await pollJoin(first);
    await confirmJoinCode(first);
    fake.complete(requestId, commit, fake.proofs.get(requestId)!);

    const reloaded = session(fake, vaults);
    await reloaded.start();
    expect(reloaded.phase).toBe("ready");
  });

  it("offers an approval made while the tab was closed, by its code", async () => {
    const fake = new FakeAccountService().seed();
    const vaults = memoryVaultStore();
    await session(fake, vaults).start();
    const requestId = onlyRequest(fake);
    const { sas, commit } = fake.approve(requestId);
    fake.complete(requestId, commit, fake.proofs.get(requestId)!);

    const reloaded = session(fake, vaults);
    await reloaded.start();
    expect(reloaded.join).toEqual({ kind: "alreadyApproved", sas, approverName: "Phone" });
    await confirmApprovedJoin(reloaded);
    expect(reloaded.phase).toBe("ready");
  });

  it("signs out and drops its keys when that approval isn't recognised", async () => {
    const fake = new FakeAccountService().seed();
    const vaults = memoryVaultStore();
    await session(fake, vaults).start();
    const requestId = onlyRequest(fake);
    const { commit } = fake.approve(requestId);
    fake.complete(requestId, commit, fake.proofs.get(requestId)!);

    const reloaded = session(fake, vaults);
    await reloaded.start();
    await rejectApprovedJoin(reloaded);
    expect(reloaded.phase).toBe("signedOut");
    expect((await vaults.load()).keys).toBeNull();
  });

  it("waits on an empty account rather than becoming its first device", async () => {
    const s = session(new FakeAccountService());
    await s.start();
    expect(s.phase).toBe("empty");
    expect(s.vault.keys).toBeNull();
  });
});

describe("a joined browser", () => {
  async function joined() {
    const fake = new FakeAccountService().seed();
    const s = session(fake);
    await s.start();
    const requestId = onlyRequest(fake);
    const { commit } = fake.approve(requestId);
    await pollJoin(s);
    await confirmJoinCode(s);
    fake.complete(requestId, commit, fake.proofs.get(requestId)!);
    await pollJoin(s);

    return { fake, s };
  }

  it("renames itself on the account", async () => {
    const { fake, s } = await joined();
    expect(await s.setName("Work laptop")).toBe(true);
    expect(fake.state!.members[s.vault.keys!.memberId].member.name).toBe("Work laptop");
    expect(s.vault.pendingName).toBeNull();
  });

  it("hands a host that's behind the entries it lacks", async () => {
    const { s } = await joined();
    const hash = sha256Hex(s.state!.account_id);
    const payload = s.syncPayload({ linked: true, account_id_hash: hash, head_seq: 1 });
    expect(payload?.entries).toHaveLength(s.state!.head.seq - 1);
    expect(s.syncPayload({ linked: true, account_id_hash: "other", head_seq: 1 })).toBeNull();
    expect(
      s.syncPayload({ linked: true, account_id_hash: hash, head_seq: s.state!.head.seq }),
    ).toBeNull();
  });

  it("revokes itself and forgets everything on sign out", async () => {
    const { fake, s } = await joined();
    const id = s.vault.keys!.memberId;
    await s.signOut();
    expect(fake.state!.members[id].live).toBe(false);
    expect(s.phase).toBe("signedOut");
    expect(s.vault.keys).toBeNull();
  });

  it("forgets the account once another device removes it", async () => {
    const { fake, s } = await joined();
    fake.revokeAsPhone(s.vault.keys!.memberId);
    await s.refresh();
    expect(s.phase).toBe("signedOut");
    expect(s.error).toMatch(/removed/);
  });
});
