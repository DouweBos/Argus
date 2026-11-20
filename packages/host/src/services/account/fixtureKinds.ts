/**
 * Fixtures for device kinds: an Android phone, and a kind no client knows yet,
 * which every verifier must accept (still checking signatures) so a newer
 * client joining never bricks the account for older ones.
 */

import type { Fixture } from "./fixtureBuilder";
import { makeProof } from "@argus/remote-protocol";
import { Chain, device, host, keys, mini, phone } from "./fixtureChain";

export const pixel = keys("00000000-0000-4000-8000-000000000010", 10);
export const future = keys("00000000-0000-4000-8000-000000000011", 11);

function addDevice(chain: Chain, kind: string, k = future): Chain {
  const member = device(k, "Future", kind);

  return chain.add(phone, {
    type: "add_device",
    member,
    request_id: "",
    sas_commit: "",
    proof: makeProof(member, k.sign_priv),
  });
}

/** Kinds every verifier must accept as a device, and ones it must reject. */
export function deviceKindVector() {
  const valid = ["ios", "android", "mac", "electron", "web", "visionos", "a"];
  valid.push(`k${"_".repeat(31)}`);
  const invalid = ["", "Android", "vision os", "1phone", "_x", "x-y", "ios\n"];
  invalid.push(`k${"_".repeat(32)}`, "é", "i\u0000");

  return { valid, invalid };
}

export function kindFixtures(): Fixture[] {
  const miniMember = host(mini, "Mini");
  const pixelMember = device(pixel, "Pixel", "android");
  const android = new Chain()
    .add(phone, { type: "genesis", member: device(phone, "Phone") })
    .add(phone, {
      type: "add_device",
      member: pixelMember,
      request_id: "",
      sas_commit: "",
      proof: makeProof(pixelMember, pixel.sign_priv),
    })
    // A phone approves computers, whichever kind of phone it is.
    .add(pixel, {
      type: "add_host",
      member: miniMember,
      request_id: "",
      sas_commit: "",
      proof: makeProof(miniMember, mini.sign_priv),
    })
    .add(pixel, { type: "rename", member_id: pixel.id, name: "Pixel 9" });

  const androidGenesis = new Chain().add(pixel, {
    type: "genesis",
    member: pixelMember,
  });

  const unknown = addDevice(
    new Chain().add(phone, { type: "genesis", member: device(phone, "Phone") }),
    "visionos",
  ).add(future, { type: "rename", member_id: future.id, name: "Headset" });

  const forged = addDevice(
    new Chain().add(phone, { type: "genesis", member: device(phone, "Phone") }),
    "visionos",
  );
  // The kind is signed like everything else: relabelling it breaks the entry.
  const body = JSON.parse(forged.entries[1].body) as {
    member: { kind: string };
  };
  body.member.kind = "quest";
  forged.entries[1] = { ...forged.entries[1], body: JSON.stringify(body) };

  const malformed = addDevice(
    new Chain().add(phone, { type: "genesis", member: device(phone, "Phone") }),
    "Vision OS",
  );

  return [
    {
      name: "android_member",
      description:
        "an Android phone joins, approves a computer and renames itself",
      entries: android.entries,
      expect: {
        ok: true,
        head_seq: 3,
        live_members: [phone.id, pixel.id, mini.id].sort(),
      },
    },
    {
      name: "android_genesis",
      description: "an Android phone starts the account",
      entries: androidGenesis.entries,
      expect: { ok: true, head_seq: 0, live_members: [pixel.id] },
    },
    {
      name: "unknown_device_kind",
      description:
        "a device of a kind this client doesn't know joins and signs: still trusted",
      entries: unknown.entries,
      expect: {
        ok: true,
        head_seq: 2,
        live_members: [phone.id, future.id].sort(),
      },
    },
    {
      name: "unknown_device_kind_bad_signature",
      description: "an unknown kind is no excuse for a bad signature",
      entries: forged.entries,
      expect: { ok: false, reason: "bad_signature", index: 1 },
    },
    {
      name: "malformed_device_kind",
      description: "a kind that isn't a lowercase token is malformed",
      entries: malformed.entries,
      expect: { ok: false, reason: "malformed", index: 1 },
    },
  ];
}
