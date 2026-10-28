/**
 * Fixtures for a device joining through an approval (§5.4): the approved
 * path, the subject's code check that catches a wrong code or a forked log,
 * and removing devices afterwards.
 */

import type { Fixture } from "./fixtureBuilder";
import type { Keys } from "./fixtureChain";
import { accountSas, entryHash, makeProof } from "@argus/remote-protocol";
import {
  ACCOUNT,
  Chain,
  device,
  host,
  keys,
  mini,
  phone,
  stranger,
} from "./fixtureChain";

export const tablet = keys("00000000-0000-4000-8000-000000000007", 7);
export const laptop = keys("00000000-0000-4000-8000-000000000008", 8);

const REQUEST = "6f1c2a8e-0000-4000-8000-0000000000aa";
const tabletMember = device(tablet, "Tablet");

const sasFor = (approver: Keys, headHash: string) =>
  accountSas({
    account_id: ACCOUNT,
    epoch: 0,
    head_hash: headHash,
    approver_sign_pub: approver.sign_pub,
    subject_sign_pub: tablet.sign_pub,
    subject_noise_pub: tablet.noise_pub,
    request_id: REQUEST,
  });

/** A phone and a linked mini: the account a new device asks to join. */
function account(): Chain {
  const miniMember = host(mini, "Mini");

  return new Chain()
    .add(phone, { type: "genesis", member: device(phone, "Phone") })
    .add(phone, {
      type: "add_host",
      member: miniMember,
      request_id: "",
      sas_commit: "",
      proof: makeProof(miniMember, mini.sign_priv),
    });
}

/** `approver` writes the tablet's add_device on the current head. */
function approve(chain: Chain, approver: Keys): string {
  const { commit } = sasFor(approver, chain.headHash());
  chain.add(approver, {
    type: "add_device",
    member: tabletMember,
    request_id: REQUEST,
    sas_commit: commit,
    proof: makeProof(tabletMember, tablet.sign_priv),
  });

  return commit;
}

export function joinFixtures(): Fixture[] {
  const approved = account();
  const commit = approve(approved, phone);
  approved.add(tablet, {
    type: "rename",
    member_id: tablet.id,
    name: "Work tablet",
  });

  const byHost = account();
  const hostCommit = approve(byHost, mini);

  const wrongCode = account();
  approve(wrongCode, phone);
  // The code the tablet confirmed was for another head than the one written.
  const shownElsewhere = sasFor(phone, "ff".repeat(32)).commit;

  // The service shows the tablet a log of its own making, approved by a key
  // it controls. It verifies on its own terms; the code the user compared on
  // the real phone (bound to the real head and the phone's key) does not.
  const forked = new Chain().add(stranger, {
    type: "genesis",
    member: device(stranger, "Phone"),
  });
  approve(forked, stranger);
  const realCommit = sasFor(phone, account().headHash()).commit;
  const realPin = {
    account_id: ACCOUNT,
    epoch: 0,
    genesis_hash: entryHash(account().entries[0].body),
  };

  const removed = account();
  approve(removed, phone);
  removed.add(phone, {
    type: "revoke",
    member_id: tablet.id,
    reason: "removed",
  });
  const laptopMember = device(laptop, "Laptop", "mac");
  removed.add(tablet, {
    type: "add_device",
    member: laptopMember,
    request_id: "",
    sas_commit: "",
    proof: makeProof(laptopMember, laptop.sign_priv),
  });

  const removesOther = account();
  approve(removesOther, phone);
  removesOther.add(tablet, {
    type: "revoke",
    member_id: phone.id,
    reason: "lost",
  });

  return [
    {
      name: "device_join_approved",
      description:
        "a phone approves a new device's request, which then renames itself",
      entries: approved.entries,
      expect: {
        ok: true,
        head_seq: 3,
        live_members: [phone.id, mini.id, tablet.id].sort(),
      },
      admission: {
        member_id: tablet.id,
        request_id: REQUEST,
        sas_commit: commit,
        admitted: true,
      },
    },
    {
      name: "device_join_host_approved",
      description: "a host's console approves a device (recovery, §5.8)",
      entries: byHost.entries,
      expect: {
        ok: true,
        head_seq: 2,
        live_members: [phone.id, mini.id, tablet.id].sort(),
      },
      admission: {
        member_id: tablet.id,
        request_id: REQUEST,
        sas_commit: hostCommit,
        admitted: true,
      },
    },
    {
      name: "device_join_wrong_code",
      description:
        "the add_device carries a commit for another code than the one the device confirmed",
      entries: wrongCode.entries,
      expect: {
        ok: true,
        head_seq: 2,
        live_members: [phone.id, mini.id, tablet.id].sort(),
      },
      admission: {
        member_id: tablet.id,
        request_id: REQUEST,
        sas_commit: shownElsewhere,
        admitted: false,
      },
    },
    {
      name: "device_join_forked",
      description:
        "a log the service made up approves the device; the code from the real phone refuses it",
      entries: forked.entries,
      expect: {
        ok: true,
        head_seq: 1,
        live_members: [stranger.id, tablet.id].sort(),
      },
      admission: {
        member_id: tablet.id,
        request_id: REQUEST,
        sas_commit: realCommit,
        admitted: false,
      },
    },
    {
      name: "device_join_forked_pinned",
      description: "the same made-up log against the real account's pin",
      pin: realPin,
      entries: forked.entries,
      expect: { ok: false, reason: "fork", index: 0 },
    },
    {
      name: "device_removed_cannot_write",
      description: "a removed device can no longer approve anyone",
      entries: removed.entries,
      expect: { ok: false, reason: "unknown_signer", index: 4 },
    },
    {
      name: "device_removes_device",
      description: "any device may take another device off the account",
      entries: removesOther.entries,
      expect: {
        ok: true,
        head_seq: 3,
        live_members: [mini.id, tablet.id].sort(),
      },
    },
  ];
}
