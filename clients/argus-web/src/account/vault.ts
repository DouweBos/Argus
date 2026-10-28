/**
 * What this browser keeps about its account between visits, in IndexedDB.
 * IndexedDB stores CryptoKey objects by structured clone and keeps them
 * non-extractable, which `localStorage` (strings only) couldn't.
 */

import type {
  AccountRoot,
  LogEntry,
  PresenceEndpoint,
} from "@argus/remote-protocol/account";
import type { WebDeviceKeys } from "./webKeys";

export interface CachedPresence {
  ts: number;
  lastSeen: number;
  endpoints: PresenceEndpoint[];
}

export interface PendingJoin {
  requestId: string;
  accountId: string;
  epoch: number;
}

export interface AccountVault {
  keys: WebDeviceKeys | null;
  /** Pinned on first adoption; every later log must start here. */
  root: AccountRoot | null;
  /** The verified log, from genesis. */
  entries: LogEntry[];
  presence: Record<string, CachedPresence>;
  /** The open join request, resumed after a reload instead of filing another. */
  pendingJoin: PendingJoin | null;
  /** The request and code confirmed here: only an approval carrying both is adopted. */
  joinRequestId: string | null;
  joinCommit: string | null;
  /** A rename that hasn't reached the account yet. */
  pendingName: string | null;
  /** The computer opened last, reopened on the next visit. */
  lastHostId: string | null;
}

export const EMPTY_VAULT: AccountVault = {
  keys: null,
  root: null,
  entries: [],
  presence: {},
  pendingJoin: null,
  joinRequestId: null,
  joinCommit: null,
  pendingName: null,
  lastHostId: null,
};

export interface VaultStore {
  load: () => Promise<AccountVault>;
  save: (vault: AccountVault) => Promise<void>;
}

const DB_NAME = "argus-account";
const STORE = "vault";
const KEY = "device";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb"));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);

  return request(req);
}

export function indexedDbVaultStore(
  factory: IDBFactory = indexedDB,
): VaultStore {
  let db: Promise<IDBDatabase> | null = null;
  const tx = async (mode: IDBTransactionMode) =>
    (await (db ??= openDb(factory)))
      .transaction(STORE, mode)
      .objectStore(STORE);

  return {
    load: async () => {
      const stored = (await request((await tx("readonly")).get(KEY))) as
        | Partial<AccountVault>
        | undefined;

      return { ...EMPTY_VAULT, ...stored };
    },
    save: async (vault) => {
      await request((await tx("readwrite")).put(vault, KEY));
    },
  };
}

/** For tests: round-trips through structured clone, like IndexedDB does. */
export function memoryVaultStore(): VaultStore & { saved: AccountVault | null } {
  const store = {
    saved: null as AccountVault | null,
    load: async () => ({
      ...EMPTY_VAULT,
      ...(store.saved ? structuredClone(store.saved) : {}),
    }),
    save: async (vault: AccountVault) => {
      store.saved = structuredClone(vault);
    },
  };

  return store;
}
