import { describe, expect, it } from "vitest";
import { FakeAccountService, miniKeys, phoneKeys } from "./fakeAccountService";
import { confirmJoinCode, pollJoin } from "./join";
import { deleteAccount, removeMember, renameMember } from "./members";
import { AccountSession } from "./session";
import { memoryVaultStore } from "./vault";
import { generateDeviceKeys } from "./webKeys";

/** A browser the phone approved, ready on the account. */
async function joined(fake: FakeAccountService, reverify: () => Promise<boolean>) {
  const s = new AccountSession({
    client: fake,
    vaults: memoryVaultStore(),
    auth: {
      isSignedIn: () => true,
      token: async () => "token",
      signOut: async () => {},
      reverify,
    },
    defaultName: () => "Test browser",
    generateKeys: (name, now) => generateDeviceKeys(name, now),
    now: () => 5_000,
    joinPollMs: 0,
  });
  await s.start();
  const requestId = [...fake.requests.keys()][0];
  const { commit } = fake.approve(requestId);
  await pollJoin(s);
  await confirmJoinCode(s);
  fake.complete(requestId, commit, fake.proofs.get(requestId)!);
  await pollJoin(s);
  expect(s.phase).toBe("ready");

  return s;
}

describe("managing the account from the browser", () => {
  it("renames another member and itself", async () => {
    const fake = new FakeAccountService().seed();
    const s = await joined(fake, async () => true);
    await renameMember(s, miniKeys.id, "  Mac mini ");
    expect(fake.state!.members[miniKeys.id].member.name).toBe("Mac mini");
    expect(s.state!.members[miniKeys.id].member.name).toBe("Mac mini");

    const own = s.vault.keys!.memberId;
    await renameMember(s, own, "Work laptop");
    expect(fake.state!.members[own].member.name).toBe("Work laptop");
    expect(s.name).toBe("Work laptop");
    await expect(renameMember(s, miniKeys.id, "\n")).rejects.toThrow();
  });

  it("removes a device and a computer, never itself", async () => {
    const fake = new FakeAccountService().seed();
    const s = await joined(fake, async () => true);
    await removeMember(s, miniKeys.id);
    await removeMember(s, phoneKeys.id);
    expect(fake.state!.members[miniKeys.id].live).toBe(false);
    expect(fake.state!.members[phoneKeys.id].live).toBe(false);
    expect(s.computers).toEqual([]);
    await expect(removeMember(s, s.vault.keys!.memberId)).rejects.toThrow(/Sign out/);
    await expect(removeMember(s, miniKeys.id)).rejects.toThrow(/no longer/);
  });

  it("asks to verify the sign-in before deleting the account", async () => {
    const fake = new FakeAccountService().seed();
    let asked = 0;
    const s = await joined(fake, async () => {
      asked += 1;
      fake.reverified = true;

      return true;
    });
    expect(await deleteAccount(s)).toEqual({ outcome: "deleted", reverified: true });
    expect(asked).toBe(1);
    expect(fake.entries).toEqual([]);
    expect(s.vault.keys).toBeNull();
    expect(s.phase).toBe("empty");
  });

  it("keeps the account when verifying is cancelled", async () => {
    const fake = new FakeAccountService().seed();
    const s = await joined(fake, async () => false);
    expect(await deleteAccount(s)).toEqual({ outcome: "cancelled", reverified: false });
    expect(fake.entries.length).toBeGreaterThan(0);
    expect(s.phase).toBe("ready");
  });
});
