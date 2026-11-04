/**
 * An in-memory account service for the hosted client's tests: the log with
 * its CAS, device join requests, and a phone (from the shared golden-fixture
 * keys) that approves and writes entries the way the real apps do.
 */

import type {
  DeviceMember,
  DirectoryRecord,
  HostMember,
  LogEntry,
  LogState,
  PresenceEndpoint,
} from "@argus/remote-protocol/account";
import {
  accountSas,
  makeEntry,
  makeProof,
  presenceSigningBytes,
  signB64,
  verifyLog,
} from "@argus/remote-protocol/account";
import keys from "../../../../packages/remote-protocol/src/account/fixtures/keys.json";
import {
  type AccountClient,
  type AccountInfo,
  AccountServiceError,
  type RequestStatus,
} from "./client";

const ACCOUNT = "abcdefghijklmnopqrstuvwxyz";

export const phoneKeys = keys.phone;
export const miniKeys = keys.mini;

interface JoinRequest {
  member: DeviceMember;
  status: RequestStatus;
}

export class FakeAccountService implements AccountClient {
  entries: LogEntry[] = [];
  state: LogState | null = null;
  requests = new Map<string, JoinRequest>();
  records: DirectoryRecord[] = [];
  private nextId = 1;

  /** A phone that started the account and a linked Mac mini. */
  seed(): this {
    const phone: DeviceMember = {
      id: phoneKeys.id,
      role: "device",
      kind: "ios",
      sign_pub: phoneKeys.sign_pub,
      noise_pub: phoneKeys.noise_pub,
      name: "Phone",
      created_at: 1,
    };
    const mini: HostMember = {
      id: miniKeys.id,
      role: "host",
      platform: "darwin",
      sign_pub: miniKeys.sign_pub,
      noise_pub: miniKeys.noise_pub,
      name: "Mini",
      created_at: 2,
    };
    this.write(makeEntry(this.header(), this.phone, { type: "genesis", member: phone }));
    this.write(
      makeEntry(this.header(), this.phone, {
        type: "add_host",
        member: mini,
        request_id: "",
        sas_commit: "",
        proof: makeProof(mini, miniKeys.sign_priv),
      }),
    );

    return this;
  }

  private get phone() {
    return { id: phoneKeys.id, priv: phoneKeys.sign_priv };
  }

  private header() {
    return { account_id: ACCOUNT, epoch: 0, head: this.state?.head ?? null, ts: 10 };
  }

  private write(entry: LogEntry): void {
    const result = verifyLog([entry], { prior: this.state });
    if (!result.ok) {
      throw new Error(`fake: refused ${result.reason}`);
    }
    this.state = result.state;
    this.entries.push(entry);
  }

  /** The mini publishes where it can be reached. */
  publish(endpoints: PresenceEndpoint[], ts: number, lastSeen: number): void {
    const body = JSON.stringify({
      v: 1,
      account_id: ACCOUNT,
      epoch: 0,
      host_id: miniKeys.id,
      ts,
      endpoints,
    });
    this.records = [
      {
        host_id: miniKeys.id,
        presence_body: body,
        presence_sig: signB64(presenceSigningBytes(body), miniKeys.sign_priv),
        last_seen: lastSeen,
      },
    ];
  }

  /** The phone picks the request up: both sides can now show the code. */
  approve(requestId: string): { sas: string; commit: string } {
    const request = this.requests.get(requestId)!;
    const head = this.state!.head;
    request.status = {
      status: "approving",
      approver: { id: phoneKeys.id, sign_pub: phoneKeys.sign_pub },
      head,
    };

    return accountSas({
      account_id: ACCOUNT,
      epoch: 0,
      head_hash: head.hash,
      approver_sign_pub: phoneKeys.sign_pub,
      subject_sign_pub: request.member.sign_pub,
      subject_noise_pub: request.member.noise_pub,
      request_id: requestId,
    });
  }

  /** The phone confirmed its side and writes `add_device` with `commit`. */
  complete(requestId: string, commit: string, proof: string): void {
    const request = this.requests.get(requestId)!;
    this.write(
      makeEntry(this.header(), this.phone, {
        type: "add_device",
        member: request.member,
        request_id: requestId,
        sas_commit: commit,
        proof,
      }),
    );
    request.status = { ...request.status, status: "approved", through_seq: this.state!.head.seq };
  }

  proofs = new Map<string, string>();
  /** Whether the caller's sign-in counts as recently verified (`DELETE /account`). */
  reverified = false;

  revokeAsPhone(memberId: string): void {
    this.write(
      makeEntry(this.header(), this.phone, {
        type: "revoke",
        member_id: memberId,
        reason: "removed",
      }),
    );
  }

  // --- AccountClient -------------------------------------------------------

  config = async () => ({ clerk_publishable_key: "pk_test_x", frontend_api: "https://clerk.test" });

  account = async (): Promise<AccountInfo> => ({
    account_id: ACCOUNT,
    epoch: 0,
    head_seq: this.state ? this.state.head.seq : null,
  });

  log = async (_epoch: number, after: number) => this.entries.slice(after + 1);

  append = async (_epoch: number, entries: LogEntry[]) => {
    const first = JSON.parse(entries[0].body) as { seq: number };
    if (first.seq !== this.state!.head.seq + 1) {
      throw new AccountServiceError(409, "conflict", this.state!.head.seq);
    }
    for (const entry of entries) {
      this.write(entry);
    }

    return this.state!.head.seq;
  };

  directory = async () => this.records;

  join = async (member: DeviceMember, proof: string) => {
    if (!this.state) {
      throw new AccountServiceError(409, "conflict", null);
    }
    if (this.state.members[member.id]?.live) {
      throw new AccountServiceError(409, "conflict", this.state.head.seq);
    }
    const requestId = `00000000-0000-4000-8000-0000000001${String(this.nextId++).padStart(2, "0")}`;
    this.requests.set(requestId, { member, status: { status: "claimed" } });
    this.proofs.set(requestId, proof);

    return { request_id: requestId, expires_at: 600_000 };
  };

  joinStatus = async (requestId: string) => {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new AccountServiceError(404, "not_found");
    }

    return request.status;
  };

  deleteAccount = async () => {
    if (!this.reverified) {
      throw new AccountServiceError(403, "forbidden");
    }
    this.entries = [];
    this.state = null;
    this.records = [];
  };

  deny = async (requestId: string) => {
    const request = this.requests.get(requestId);
    if (request) {
      request.status = { status: "denied" };
    }
  };
}
