/**
 * HTTP client for the account service (houwert.dev `/argus/account/v1`). The
 * host authenticates by signing each request with its Ed25519 key — no bearer
 * secret is ever issued to it. Everything the service returns is untrusted:
 * callers verify log entries and presence before acting on them.
 */

import type {
  DeviceMember,
  DirectoryRecord,
  HostMember,
  LogEntry,
} from "@argus/remote-protocol";
import { requestSigningBytes, signB64 } from "@argus/remote-protocol";

export class AccountServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(`account service: ${code} (HTTP ${status})`);
  }
}

/** Who signs: a member id once linked, the bare public key before. */
export interface RequestSigner {
  sign_priv: string;
  sign_pub: string;
  member_id: string | null;
}

export interface RequestStatus {
  status:
    | "approved"
    | "approving"
    | "claimed"
    | "denied"
    | "expired"
    | "pending";
  account_empty?: boolean;
  account_id?: string;
  epoch?: number;
  approver?: { id: string; sign_pub: string };
  head?: { seq: number; hash: string } | null;
  through_seq?: number;
}

export interface LinkStart {
  request_id: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface JoinRequestRow {
  request_id: string;
  kind: string;
  subject: {
    host?: HostMember;
    device?: DeviceMember;
    member?: DeviceMember;
    proofs?: Record<string, string>;
    proof?: string;
  };
  status: string;
  created_at: number;
  expires_at: number;
}

export interface LogPage {
  epoch: number;
  entries: LogEntry[];
  next_after: number | null;
}

export class AccountClient {
  constructor(
    private readonly baseUrl: string,
    private readonly signer: RequestSigner,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(
    method: string,
    route: string,
    payload?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${route}`);
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const ts = Date.now();
    const sig = signB64(
      requestSigningBytes(method, url.pathname + url.search, ts, body),
      this.signer.sign_priv,
    );
    const headers: Record<string, string> = {
      "x-argus-ts": String(ts),
      "x-argus-sig": sig,
      ...(this.signer.member_id
        ? { "x-argus-member": this.signer.member_id }
        : { "x-argus-key": this.signer.sign_pub }),
      ...(body ? { "content-type": "application/json" } : {}),
    };
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) {
      return undefined as T;
    }
    const parsed = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      throw new AccountServiceError(
        res.status,
        typeof parsed.error === "string" ? parsed.error : "http_error",
        parsed,
      );
    }

    return parsed as T;
  }

  linkStart(
    subject: { host: HostMember; device?: DeviceMember },
    proofs: Record<string, string>,
  ): Promise<LinkStart> {
    return this.request("POST", "/link/start", { subject, proofs });
  }

  linkStatus(requestId: string): Promise<RequestStatus> {
    return this.request("GET", `/link/${encodeURIComponent(requestId)}`);
  }

  linkCancel(requestId: string): Promise<void> {
    return this.request("DELETE", `/link/${encodeURIComponent(requestId)}`);
  }

  /** Every entry after `after` (−1 = from genesis), following pagination. */
  async log(epoch: number, after: number): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    let cursor: number | null = after;
    while (cursor !== null) {
      const page: LogPage = await this.request(
        "GET",
        `/log?epoch=${epoch}&after=${cursor}`,
      );
      entries.push(...page.entries);
      cursor = page.next_after ?? null;
    }

    return entries;
  }

  append(epoch: number, entries: LogEntry[]): Promise<{ head_seq: number }> {
    return this.request("POST", "/log", { epoch, entries });
  }

  directory(): Promise<{ hosts: DirectoryRecord[] }> {
    return this.request("GET", "/directory");
  }

  putPresence(presenceBody: string, presenceSig: string): Promise<void> {
    return this.request("PUT", "/host/presence", {
      presence_body: presenceBody,
      presence_sig: presenceSig,
    });
  }

  listJoins(): Promise<{ requests: JoinRequestRow[] }> {
    return this.request("GET", "/join");
  }

  setApprover(
    requestId: string,
    approverId: string,
  ): Promise<{ head: { seq: number; hash: string } }> {
    return this.request(
      "POST",
      `/join/${encodeURIComponent(requestId)}/approver`,
      { approver_id: approverId },
    );
  }

  deny(requestId: string): Promise<void> {
    return this.request(
      "POST",
      `/join/${encodeURIComponent(requestId)}/deny`,
      {},
    );
  }
}
