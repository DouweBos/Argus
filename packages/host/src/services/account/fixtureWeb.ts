/**
 * Fixtures for a browser on the account: it may take trust away (revoke,
 * rename) but never approve a join or start an account, because the page
 * holding its key is served by the account service's operator.
 */

import type { Fixture } from "./fixtureBuilder";
import { makeProof } from "@argus/remote-protocol";
import {
  Chain,
  device,
  host,
  keys,
  mac,
  mini,
  phone,
  stranger,
} from "./fixtureChain";
import { tablet } from "./fixtureJoins";

export const browser = keys("00000000-0000-4000-8000-000000000009", 9);

const browserMember = device(browser, "Browser", "web");

/** A phone, a linked mini, and a browser the phone approved. */
function withBrowser(): Chain {
  const miniMember = host(mini, "Mini");

  return new Chain()
    .add(phone, { type: "genesis", member: device(phone, "Phone") })
    .add(phone, {
      type: "add_host",
      member: miniMember,
      request_id: "",
      sas_commit: "",
      proof: makeProof(miniMember, mini.sign_priv),
    })
    .add(phone, {
      type: "add_device",
      member: browserMember,
      request_id: "",
      sas_commit: "",
      proof: makeProof(browserMember, browser.sign_priv),
    });
}

export function webFixtures(): Fixture[] {
  const removes = withBrowser();
  const tabletMember = device(tablet, "Tablet");
  removes
    .add(phone, {
      type: "add_device",
      member: tabletMember,
      request_id: "",
      sas_commit: "",
      proof: makeProof(tabletMember, tablet.sign_priv),
    })
    .add(browser, { type: "rename", member_id: tablet.id, name: "Old tablet" })
    .add(browser, { type: "revoke", member_id: tablet.id, reason: "removed" })
    .add(browser, { type: "rename", member_id: mini.id, name: "Mac mini" })
    .add(browser, { type: "revoke", member_id: mini.id, reason: "removed" })
    .add(browser, { type: "rename", member_id: browser.id, name: "Work" });

  const approvesDevice = withBrowser();
  const evil = device(stranger, "Evil");
  approvesDevice.add(browser, {
    type: "add_device",
    member: evil,
    request_id: "",
    sas_commit: "",
    proof: makeProof(evil, stranger.sign_priv),
  });

  const addsHost = withBrowser();
  const evilHost = host(mac, "Evil");
  addsHost.add(browser, {
    type: "add_host",
    member: evilHost,
    request_id: "",
    sas_commit: "",
    proof: makeProof(evilHost, mac.sign_priv),
  });

  const genesis = new Chain().add(browser, {
    type: "genesis",
    member: browserMember,
  });

  return [
    {
      name: "web_member_removes_and_renames",
      description:
        "a browser the phone approved renames and removes other members",
      entries: removes.entries,
      expect: {
        ok: true,
        head_seq: removes.entries.length - 1,
        live_members: [phone.id, browser.id].sort(),
      },
    },
    {
      name: "web_approves_device",
      description: "a browser signs an add_device for a key it chose",
      entries: approvesDevice.entries,
      expect: { ok: false, reason: "web_approver", index: 3 },
    },
    {
      name: "web_adds_host",
      description: "a browser signs an add_host",
      entries: addsHost.entries,
      expect: { ok: false, reason: "web_approver", index: 3 },
    },
    {
      name: "web_genesis",
      description: "a browser starts the account",
      entries: genesis.entries,
      expect: { ok: false, reason: "web_approver", index: 0 },
    },
  ];
}
