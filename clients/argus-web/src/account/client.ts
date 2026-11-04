/**
 * The browser's side of the account service. It only carries signed
 * statements and public keys; nothing it returns is trusted until the log
 * verifier has seen it.
 */

import type {
  DeviceMember,
  DirectoryRecord,
  LogEntry,
} from "@argus/remote-protocol/account";

/** Same origin as the hosted app, so no CORS and a strict `connect-src`. */
export const DEFAULT_ACCOUNT_URL = "/argus/account/v1";

export interface AccountConfig {
  clerk_publishable_key: string;
  frontend_api: string;
  managed_tunnels?: boolean;
}

export interface AccountInfo {
  account_id: string;
  epoch: number;
  head_seq: number | null;
}

export interface RequestStatus {
  status: "pending" | "claimed" | "approving" | "approved" | "denied" | "expired";
  approver?: { id: string; sign_pub: string };
  head?: { seq: number; hash: string };
  through_seq?: number;
}

export class AccountServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly headSeq: number | null = null,
  ) {
    super(code ?? `http ${status}`);
    this.name = "AccountServiceError";
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

export const UNTRUSTED_LOG =
  "The account service sent a log that doesn't check out, so nothing was changed.";

/** `fresh` skips the provider's cache, e.g. to carry a reverification just made. */
export type TokenProvider = (opts?: { fresh?: boolean }) => Promise<string | null>;

export interface AccountClient {
  config: () => Promise<AccountConfig>;
  account: () => Promise<AccountInfo>;
  /** Every entry after `after` (−1 for the whole log), following pages. */
  log: (epoch: number, after: number) => Promise<LogEntry[]>;
  append: (epoch: number, entries: LogEntry[]) => Promise<number>;
  directory: () => Promise<DirectoryRecord[]>;
  join: (
    member: DeviceMember,
    proof: string,
  ) => Promise<{ request_id: string; expires_at: number }>;
  joinStatus: (requestId: string) => Promise<RequestStatus>;
  deny: (requestId: string) => Promise<void>;
  /** Needs a sign-in verified in the last 10 minutes; 403 otherwise. */
  deleteAccount: () => Promise<void>;
}

export function describeAccountError(error: unknown): string {
  if (error instanceof AccountServiceError) {
    switch (error.status) {
      case 0:
        return "Couldn't reach the account service.";
      case 401:
        return "You're signed out. Sign in again.";
      case 409:
        return "Your account changed at the same time. Try again.";
      case 422:
        return "The account service refused the change.";
      case 429:
        return "Too many attempts. Wait a few minutes and try again.";
      default:
        return `The account service answered ${error.status}.`;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

export function accountClient(
  token: TokenProvider,
  baseUrl: string = DEFAULT_ACCOUNT_URL,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): AccountClient {
  async function send<T>(
    method: string,
    path: string,
    opts: { body?: unknown; auth?: boolean; fresh?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (opts.auth !== false) {
      const bearer = await token({ fresh: opts.fresh });
      if (!bearer) {
        throw new AccountServiceError(401, "unauthorized");
      }
      headers.authorization = `Bearer ${bearer}`;
    }
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: "omit",
      });
    } catch {
      throw new AccountServiceError(0, "transport");
    }
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new AccountServiceError(
        res.status,
        typeof payload.error === "string" ? payload.error : null,
        typeof payload.head_seq === "number" ? payload.head_seq : null,
      );
    }

    return payload as T;
  }

  return {
    config: () => send("GET", "config", { auth: false }),
    account: () => send("POST", "account", { body: {} }),
    log: async (epoch, after) => {
      const entries: LogEntry[] = [];
      let cursor = after;
      for (;;) {
        const page = await send<{
          entries: LogEntry[];
          next_after: number | null;
        }>("GET", `log?epoch=${epoch}&after=${cursor}`);
        entries.push(...page.entries);
        if (
          page.next_after === null ||
          page.next_after <= cursor ||
          page.entries.length === 0
        ) {
          return entries;
        }
        cursor = page.next_after;
      }
    },
    append: async (epoch, entries) =>
      (
        await send<{ head_seq: number }>("POST", "log", {
          body: { epoch, entries },
        })
      ).head_seq,
    directory: async () =>
      (await send<{ hosts: DirectoryRecord[] }>("GET", "directory")).hosts,
    join: (member, proof) => send("POST", "join", { body: { member, proof } }),
    joinStatus: (requestId) =>
      send("GET", `join/${encodeURIComponent(requestId)}`),
    deny: async (requestId) => {
      await send("POST", `join/${encodeURIComponent(requestId)}/deny`, {
        body: {},
      });
    },
    deleteAccount: async () => {
      await send("DELETE", "account", { body: {}, fresh: true });
    },
  };
}
