/**
 * Golden fixtures for the account log verifier, shared by the TS and Swift
 * test suites. Deterministic (byte-filled seeds, fixed timestamps), so
 * `pnpm gen:account-fixtures` reproduces them exactly; a test fails on drift.
 */

import type { LogEntry } from "@argus/remote-protocol";
import {
  accountSas,
  admitsMember,
  entryHash,
  makeEntry,
  makeProof,
  presenceSigningBytes,
  signB64,
  verifyLog,
} from "@argus/remote-protocol";
import {
  ACCOUNT,
  Chain,
  device,
  electron,
  host,
  type Keys,
  mac,
  mini,
  phone,
  phoneNext,
  signer,
  stranger,
  TS,
} from "./fixtureChain";
import { joinFixtures, laptop, tablet } from "./fixtureJoins";
import { pushKeyVector } from "./fixturePush";
import { requestSigningVector } from "./fixtureRequests";
import { browser, webFixtures } from "./fixtureWeb";

const miniMember = host(mini, "Mini");
const sasForMini = (approver: Keys, headHash: string) =>
  accountSas({
    account_id: ACCOUNT,
    epoch: 0,
    head_hash: headHash,
    approver_sign_pub: approver.sign_pub,
    subject_sign_pub: mini.sign_pub,
    subject_noise_pub: mini.noise_pub,
    request_id: "req-mini",
  });

function base(): Chain {
  return new Chain().add(phone, {
    type: "genesis",
    member: device(phone, "Phone"),
  });
}

function withMini(): Chain {
  const chain = base();
  const { commit } = sasForMini(phone, chain.headHash());

  return chain.add(phone, {
    type: "add_host",
    member: miniMember,
    request_id: "req-mini",
    sas_commit: commit,
    proof: makeProof(miniMember, mini.sign_priv),
  });
}

function validChain(): Chain {
  const chain = withMini();
  const electronMember = device(electron, "Mini window", "electron");
  chain.add(mini, {
    type: "add_device",
    member: electronMember,
    request_id: "",
    sas_commit: "",
    proof: makeProof(electronMember, electron.sign_priv),
  });
  const macMember = host(mac, "Studio");
  chain.add(phone, {
    type: "add_host",
    member: macMember,
    request_id: "",
    sas_commit: "",
    proof: makeProof(macMember, mac.sign_priv),
  });
  chain.add(phone, { type: "rename", member_id: mini.id, name: "Mac mini" });
  chain.add(phone, {
    type: "rotate",
    member_id: phone.id,
    sign_pub: phoneNext.sign_pub,
    noise_pub: phoneNext.noise_pub,
    proof: makeProof(
      {
        ...device(phone, "Phone"),
        sign_pub: phoneNext.sign_pub,
        noise_pub: phoneNext.noise_pub,
      },
      phoneNext.sign_priv,
    ),
  });
  // After rotating, only the new key signs for the phone.
  chain.add(phoneNext, {
    type: "revoke",
    member_id: mac.id,
    reason: "removed",
  });
  chain.add(electron, {
    type: "revoke",
    member_id: electron.id,
    reason: "unlinked",
  });

  return chain;
}

function tamper(
  entry: LogEntry,
  edit: (body: Record<string, unknown>) => void,
): LogEntry {
  const body = JSON.parse(entry.body) as Record<string, unknown>;
  edit(body);

  return { body: JSON.stringify(body), sigs: entry.sigs };
}

function presence(by: Keys, fields: Record<string, unknown>) {
  const body = JSON.stringify({
    v: 1,
    account_id: ACCOUNT,
    epoch: 0,
    host_id: mini.id,
    ts: TS + 1000,
    endpoints: [
      { kind: "lan", url: "ws://192.168.1.20:47615", priority: 0 },
      {
        kind: "cloudflare",
        url: "wss://quick-example.trycloudflare.com",
        priority: 2,
      },
    ],
    ...fields,
  });

  return {
    host_id: mini.id,
    presence_body: body,
    presence_sig: signB64(presenceSigningBytes(body), by.sign_priv),
    last_seen: TS + 2000,
  };
}

export interface Fixture {
  name: string;
  description: string;
  pin?: { account_id: string; epoch: number; genesis_hash: string };
  entries: LogEntry[];
  expect:
    | { ok: false; reason: string; index: number }
    | { ok: true; head_seq: number; live_members: string[] };
  admission?: {
    member_id: string;
    request_id: string;
    sas_commit: string;
    admitted: boolean;
  };
  presence?: { record: ReturnType<typeof presence>; valid: boolean }[];
}

function fixtures(): Fixture[] {
  const valid = validChain();
  const genesisHash = entryHash(valid.entries[0].body);
  const mini2 = withMini();
  const miniCommit = sasForMini(
    phone,
    entryHash(base().entries[0].body),
  ).commit;

  const unknown = base().add(stranger, {
    type: "rename",
    member_id: phone.id,
    name: "x",
  });
  const hostRevokesOther = withMini().add(mini, {
    type: "revoke",
    member_id: phone.id,
    reason: "removed",
  });
  const badRotate = base();
  badRotate.add(phone, {
    type: "rotate",
    member_id: phone.id,
    sign_pub: phoneNext.sign_pub,
    noise_pub: phoneNext.noise_pub,
    // Signed by the old key, not the new one: no proof of possession.
    proof: makeProof(
      {
        ...device(phone, "Phone"),
        sign_pub: phoneNext.sign_pub,
        noise_pub: phoneNext.noise_pub,
      },
      phone.sign_priv,
    ),
  });
  const revokedSigner = withMini()
    .add(phone, { type: "revoke", member_id: mini.id, reason: "removed" })
    .add(mini, { type: "rename", member_id: mini.id, name: "Ghost" });
  const epochReset = new Chain(ACCOUNT, 1).add(stranger, {
    type: "genesis",
    member: device(stranger, "Attacker"),
  });

  const list: Fixture[] = [
    {
      name: "valid_chain",
      description:
        "genesis, add_host, host adds its window, local add_host, rename, rotate, revokes",
      entries: valid.entries,
      expect: {
        ok: true,
        head_seq: valid.entries.length - 1,
        live_members: [phone.id, mini.id].sort(),
      },
      admission: {
        member_id: mini.id,
        request_id: "req-mini",
        sas_commit: miniCommit,
        admitted: true,
      },
      presence: [
        { record: presence(mini, {}), valid: true },
        { record: presence(stranger, {}), valid: false },
        { record: presence(mini, { host_id: phone.id }), valid: false },
        {
          record: presence(mini, { account_id: "someone-else" }),
          valid: false,
        },
      ],
    },
    {
      name: "pinned_ok",
      description: "the same chain against the pin it started from",
      pin: { account_id: ACCOUNT, epoch: 0, genesis_hash: genesisHash },
      entries: valid.entries,
      expect: {
        ok: true,
        head_seq: valid.entries.length - 1,
        live_members: [phone.id, mini.id].sort(),
      },
    },
    {
      name: "sas_mismatch",
      description: "the add_host carries a commit the subject never confirmed",
      entries: mini2.entries,
      expect: {
        ok: true,
        head_seq: 1,
        live_members: [phone.id, mini.id].sort(),
      },
      admission: {
        member_id: mini.id,
        request_id: "req-mini",
        sas_commit: "00".repeat(32),
        admitted: false,
      },
    },
    {
      name: "bad_signature",
      description: "a body edited after signing",
      entries: [
        mini2.entries[0],
        tamper(mini2.entries[1], (b) => {
          (b.member as Record<string, unknown>).noise_pub = stranger.noise_pub;
        }),
      ],
      expect: { ok: false, reason: "bad_signature", index: 1 },
    },
    {
      name: "missing_signature",
      description: "an add_host with no signature at all",
      entries: [mini2.entries[0], { body: mini2.entries[1].body, sigs: {} }],
      expect: { ok: false, reason: "bad_signature", index: 1 },
    },
    {
      name: "wrong_prev",
      description: "an entry that does not extend the head",
      entries: (() => {
        const chain = base();
        chain.entries.push(
          makeEntry(
            {
              account_id: ACCOUNT,
              epoch: 0,
              head: { seq: 0, hash: "ff".repeat(32) },
              ts: TS,
            },
            signer(phone),
            { type: "rename", member_id: phone.id, name: "Forked" },
          ),
        );

        return chain.entries;
      })(),
      expect: { ok: false, reason: "fork", index: 1 },
    },
    {
      name: "unknown_signer",
      description: "an entry signed by a key that is not in the log",
      entries: unknown.entries,
      expect: { ok: false, reason: "unknown_signer", index: 1 },
    },
    {
      name: "host_revokes_other",
      description: "a host may only revoke itself",
      entries: hostRevokesOther.entries,
      expect: { ok: false, reason: "unknown_signer", index: 2 },
    },
    {
      name: "revoked_signer",
      description: "a revoked member can no longer write",
      entries: revokedSigner.entries,
      expect: { ok: false, reason: "unknown_signer", index: 3 },
    },
    {
      name: "rotate_without_new_key",
      description: "rotate whose proof is not signed by the new key",
      entries: badRotate.entries,
      expect: { ok: false, reason: "bad_signature", index: 1 },
    },
    {
      name: "epoch_reset_not_followed",
      description: "a fresh genesis for epoch 1 against an epoch-0 pin",
      pin: { account_id: ACCOUNT, epoch: 0, genesis_hash: genesisHash },
      entries: epochReset.entries,
      expect: { ok: false, reason: "fork", index: 0 },
    },
    {
      name: "unsigned_add_device_injected",
      description:
        "the service slips in an add_device signed by nobody it knows",
      entries: (() => {
        const chain = withMini();
        const evil = device(stranger, "Evil");
        chain.add(stranger, {
          type: "add_device",
          member: evil,
          request_id: "",
          sas_commit: "",
          proof: makeProof(evil, stranger.sign_priv),
        });

        return chain.entries;
      })(),
      expect: { ok: false, reason: "unknown_signer", index: 2 },
    },
    {
      name: "malformed_body",
      description: "a signed body that is not a valid entry",
      entries: (() => {
        const chain = base();
        chain.add(phone, { type: "teleport", member_id: phone.id });

        return chain.entries;
      })(),
      expect: { ok: false, reason: "malformed", index: 1 },
    },
    ...joinFixtures(),
    ...webFixtures(),
  ];

  // Self-check: the TS verifier must agree before anything is written.
  for (const f of list) {
    const result = verifyLog(f.entries, { root: f.pin ?? null });
    if (result.ok !== f.expect.ok) {
      throw new Error(
        `${f.name}: expected ok=${f.expect.ok}, got ${JSON.stringify(result.ok ? true : result.reason)}`,
      );
    }
    const admission = f.admission;
    if (
      result.ok &&
      admission &&
      admitsMember(result.state, admission.member_id, admission) !==
        admission.admitted
    ) {
      throw new Error(`${f.name}: admission disagrees`);
    }
  }

  return list;
}

function sasVectors() {
  const input = {
    account_id: ACCOUNT,
    epoch: 3,
    head_hash: "0f".repeat(32),
    approver_sign_pub: phone.sign_pub,
    subject_sign_pub: mini.sign_pub,
    subject_noise_pub: mini.noise_pub,
    request_id: "6f1c2a8e-0000-4000-8000-00000000abcd",
  };

  return [{ input, ...accountSas(input) }];
}

export function buildFixtures(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "keys.json": {
      phone,
      phone_next: phoneNext,
      mini,
      mac,
      electron,
      stranger,
      tablet,
      laptop,
      browser,
    },
    "sas.json": sasVectors(),
    "push_key.json": pushKeyVector(),
    "request_signing.json": requestSigningVector(),
  };
  for (const f of fixtures()) {
    out[`${f.name}.json`] = f;
  }

  return out;
}
