/**
 * The account log verifier: one pure function every host and client runs over
 * the entries the (untrusted) service hands out. Mirrored in Swift by
 * `ArgusKit/Account/AccountLog.swift`; both are held to `fixtures/*.json`.
 */

import {
  type AccountMember,
  type AccountRoot,
  type DirectoryRecord,
  LogBody,
  type LogEntry,
  PresenceBody,
} from "./schema";
import {
  entryHash,
  entrySigningBytes,
  presenceSigningBytes,
  proofSigningBytes,
  verifyB64,
} from "./sign";

export type LogRejectReason =
  | "bad_signature"
  | "fork"
  | "malformed"
  | "unknown_signer"
  | "web_approver";

export interface MemberState {
  member: AccountMember;
  live: boolean;
  /** The request the member joined through; "" for genesis and local links. */
  request_id: string;
  sas_commit: string;
  /** The member that wrote its `add_*` (itself for genesis). */
  added_by: string;
}

export interface LogState {
  account_id: string;
  epoch: number;
  genesis_hash: string;
  head: { seq: number; hash: string };
  members: Record<string, MemberState>;
}

export type VerifyResult =
  | {
      ok: false;
      reason: LogRejectReason;
      index: number;
      /** The last good state, or null when nothing verified. */
      state: LogState | null;
    }
  | { ok: true; state: LogState };

class Reject extends Error {
  constructor(readonly reason: LogRejectReason) {
    super(reason);
  }
}

function cloneState(state: LogState): LogState {
  return {
    ...state,
    head: { ...state.head },
    members: Object.fromEntries(
      Object.entries(state.members).map(([id, m]) => [
        id,
        { ...m, member: { ...m.member } },
      ]),
    ),
  };
}

function liveMember(state: LogState, id: string): MemberState | null {
  const found = state.members[id];

  return found?.live ? found : null;
}

function isWeb(member: AccountMember): boolean {
  return member.role === "device" && member.kind === "web";
}

function signKeyInUse(state: LogState, signPub: string): boolean {
  return Object.values(state.members).some(
    (m) => m.member.sign_pub === signPub,
  );
}

function parseBody(body: string): LogBody {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Reject("malformed");
  }
  const parsed = LogBody.safeParse(raw);
  if (!parsed.success) {
    throw new Reject("malformed");
  }

  return parsed.data;
}

/** Peek at the signer without trusting anything, to pick the verification key. */
function claimedSigner(body: string): string {
  try {
    const raw = JSON.parse(body) as { signer?: unknown };

    return typeof raw.signer === "string" ? raw.signer : "";
  } catch {
    throw new Reject("malformed");
  }
}

function verifyGenesis(entry: LogEntry, root: AccountRoot | null): LogState {
  const body = parseBody(entry.body);
  if (body.type !== "genesis") {
    throw new Reject("fork");
  }
  const sig = entry.sigs[body.signer];
  if (
    !sig ||
    !verifyB64(entrySigningBytes(entry.body), sig, body.member.sign_pub)
  ) {
    throw new Reject("bad_signature");
  }
  if (body.seq !== 0 || body.prev !== "") {
    throw new Reject("fork");
  }
  if (body.signer !== body.member.id) {
    throw new Reject("unknown_signer");
  }
  if (isWeb(body.member)) {
    throw new Reject("web_approver");
  }
  const hash = entryHash(entry.body);
  if (
    root &&
    (root.account_id !== body.account_id ||
      root.epoch !== body.epoch ||
      root.genesis_hash !== hash)
  ) {
    throw new Reject("fork");
  }

  return {
    account_id: body.account_id,
    epoch: body.epoch,
    genesis_hash: hash,
    head: { seq: 0, hash },
    members: {
      [body.member.id]: {
        member: body.member,
        live: true,
        request_id: "",
        sas_commit: "",
        added_by: body.member.id,
      },
    },
  };
}

function applyEntry(state: LogState, entry: LogEntry): void {
  const signerId = claimedSigner(entry.body);
  const signer = state.members[signerId];
  const sig = entry.sigs[signerId];
  if (!signer) {
    throw new Reject("unknown_signer");
  }
  if (
    !sig ||
    !verifyB64(entrySigningBytes(entry.body), sig, signer.member.sign_pub)
  ) {
    throw new Reject("bad_signature");
  }
  const body = parseBody(entry.body);
  if (
    body.account_id !== state.account_id ||
    body.epoch !== state.epoch ||
    body.seq !== state.head.seq + 1 ||
    body.prev !== state.head.hash
  ) {
    throw new Reject("fork");
  }
  if (!signer.live) {
    throw new Reject("unknown_signer");
  }
  const signerRole = signer.member.role;
  // A browser runs whatever page the site serves, so it may only take trust away.
  if (
    isWeb(signer.member) &&
    (body.type === "add_device" || body.type === "add_host")
  ) {
    throw new Reject("web_approver");
  }

  switch (body.type) {
    case "genesis":
      throw new Reject("fork");
    case "add_device":
    case "add_host": {
      const { member } = body;
      if (state.members[member.id] || signKeyInUse(state, member.sign_pub)) {
        throw new Reject("malformed");
      }
      if (!verifyB64(proofSigningBytes(member), body.proof, member.sign_pub)) {
        throw new Reject("bad_signature");
      }
      state.members[member.id] = {
        member,
        live: true,
        request_id: body.request_id,
        sas_commit: body.sas_commit,
        added_by: signerId,
      };
      break;
    }
    case "revoke": {
      if (signerRole === "host" && body.member_id !== signerId) {
        throw new Reject("unknown_signer");
      }
      const target = liveMember(state, body.member_id);
      if (!target) {
        throw new Reject("malformed");
      }
      target.live = false;
      break;
    }
    case "rotate": {
      if (body.member_id !== signerId) {
        throw new Reject("unknown_signer");
      }
      const target = liveMember(state, body.member_id);
      if (!target || signKeyInUse(state, body.sign_pub)) {
        throw new Reject("malformed");
      }
      const proved = verifyB64(
        proofSigningBytes({
          id: body.member_id,
          role: target.member.role,
          sign_pub: body.sign_pub,
          noise_pub: body.noise_pub,
        }),
        body.proof,
        body.sign_pub,
      );
      if (!proved) {
        throw new Reject("bad_signature");
      }
      target.member = {
        ...target.member,
        sign_pub: body.sign_pub,
        noise_pub: body.noise_pub,
      };
      break;
    }
    case "rename": {
      if (signerRole === "host" && body.member_id !== signerId) {
        throw new Reject("unknown_signer");
      }
      const target = liveMember(state, body.member_id);
      if (!target) {
        throw new Reject("malformed");
      }
      target.member = { ...target.member, name: body.name };
      break;
    }
  }
  state.head = { seq: body.seq, hash: entryHash(entry.body) };
}

/**
 * Verify `entries` on top of `prior` (or from genesis when there is none).
 * Pass `root` to pin the account a client already trusts; a log that starts
 * anywhere else is a fork.
 */
export function verifyLog(
  entries: LogEntry[],
  opts: { root?: AccountRoot | null; prior?: LogState | null } = {},
): VerifyResult {
  let state: LogState | null = opts.prior ? cloneState(opts.prior) : null;
  if (state && opts.root && state.genesis_hash !== opts.root.genesis_hash) {
    return { ok: false, reason: "fork", index: 0, state: null };
  }
  for (let index = 0; index < entries.length; index += 1) {
    try {
      if (!state) {
        state = verifyGenesis(entries[index], opts.root ?? null);
      } else {
        const next = cloneState(state);
        applyEntry(next, entries[index]);
        state = next;
      }
    } catch (err) {
      if (err instanceof Reject) {
        return { ok: false, reason: err.reason, index, state };
      }
      throw err;
    }
  }
  if (!state) {
    return { ok: false, reason: "malformed", index: 0, state: null };
  }

  return { ok: true, state };
}

export function liveMembers(state: LogState): AccountMember[] {
  return Object.values(state.members)
    .filter((m) => m.live)
    .map((m) => m.member);
}

/** A presence record only counts when its live host signed it for this account. */
export function verifyPresence(
  state: LogState,
  record: DirectoryRecord,
): PresenceBody | null {
  const host = liveMember(state, record.host_id);
  if (!host || host.member.role !== "host") {
    return null;
  }
  if (
    !verifyB64(
      presenceSigningBytes(record.presence_body),
      record.presence_sig,
      host.member.sign_pub,
    )
  ) {
    return null;
  }
  let parsed;
  try {
    parsed = PresenceBody.safeParse(JSON.parse(record.presence_body));
  } catch {
    return null;
  }
  if (
    !parsed.success ||
    parsed.data.host_id !== record.host_id ||
    parsed.data.account_id !== state.account_id ||
    parsed.data.epoch !== state.epoch
  ) {
    return null;
  }

  return parsed.data;
}

/**
 * The subject's own check before adopting a log: it is in it, live, and was
 * added through the request and code it confirmed (§5.3).
 */
export function admitsMember(
  state: LogState,
  memberId: string,
  expected: { request_id: string; sas_commit: string },
): boolean {
  const found = liveMember(state, memberId);

  return (
    !!found &&
    found.request_id === expected.request_id &&
    found.sas_commit === expected.sas_commit
  );
}
