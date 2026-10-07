/**
 * The stores sealed with the host's secret storage, and the one-time move of
 * blobs Electron's `safeStorage` wrote onto the scheme every host shares.
 *
 * Only Electron can read a `safeStorage` blob, so only Electron migrates; any
 * other host finds the old blobs with {@link findLegacySecretStores} and tells
 * the user to open the Electron app once. A store Electron fails to move stays
 * on `safeStorage` for that run ({@link secretStorageFor}) and is retried at
 * the next launch, so a failed move never costs it pairings or sign-ins.
 */

import type { SecretStorage } from "../../platform";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { isNodeSecretBlob } from "../../lib/nodeSecretStorage";
import { hostPlatform } from "../../platform";

export type SecretStoreId = "mcp_tokens" | "remote_devices";

export type SecretStoreMigrationOutcome = "already" | "failed" | "migrated";

export interface SecretStoreMigration {
  store: SecretStoreId;
  outcome: SecretStoreMigrationOutcome;
  /** Why it failed, for the log. Never sent anywhere. */
  error?: string;
}

/** An encrypted value in a store's JSON: read and replace its base64 blob. */
interface BlobSlot {
  get: () => string;
  set: (b64: string) => void;
}

interface EncEntry {
  enc?: unknown;
  data?: unknown;
}

function slotOf(entry: EncEntry | undefined): BlobSlot | null {
  if (!entry || entry.enc !== true || typeof entry.data !== "string") {
    return null;
  }

  return {
    get: () => entry.data as string,
    set: (b64) => {
      entry.data = b64;
    },
  };
}

const STORES: Record<
  SecretStoreId,
  { file: string; slots: (json: unknown) => BlobSlot[] }
> = {
  remote_devices: {
    file: "remote-devices.json",
    slots: (json) => [slotOf(json as EncEntry)].filter((s) => s !== null),
  },
  mcp_tokens: {
    file: "mcp-tokens.json",
    slots: (json) =>
      Object.values(
        ((json as { servers?: Record<string, EncEntry> }).servers ??
          {}) as Record<string, EncEntry>,
      )
        .map(slotOf)
        .filter((s) => s !== null),
  },
};

export const SECRET_STORE_IDS = Object.keys(STORES) as SecretStoreId[];

export function secretStorePath(store: SecretStoreId): string {
  return path.join(argusHomeDir(), STORES[store].file);
}

/** Holds the original store until the rewritten one has been read back. */
export function secretStoreBackupPath(store: SecretStoreId): string {
  return `${secretStorePath(store)}.safestorage-backup`;
}

function isLegacyBlob(b64: string): boolean {
  return !isNodeSecretBlob(Buffer.from(b64, "base64"));
}

function readStore(store: SecretStoreId): unknown {
  try {
    return JSON.parse(fs.readFileSync(secretStorePath(store), "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

/** Stores still holding a blob only Electron's `safeStorage` can open. */
export function findLegacySecretStores(): SecretStoreId[] {
  return SECRET_STORE_IDS.filter((store) => {
    try {
      const json = readStore(store);

      return (
        json !== undefined &&
        STORES[store].slots(json).some((s) => isLegacyBlob(s.get()))
      );
    } catch {
      return false;
    }
  });
}

/** What to tell a host that can't read a store Electron sealed. */
export function legacySecretStoreMessage(what: string): string {
  return `${what} were saved by an older Argus desktop app in a format only it can read. Open the Argus Electron app once so it can move them over, quit it, then start this app again.`;
}

function writeAtomically(file: string, contents: string): void {
  const tmp = `${file}.migrating-${process.pid}`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function migrateStore(
  store: SecretStoreId,
  legacy: SecretStorage | undefined,
  current: SecretStorage,
): SecretStoreMigration | null {
  const file = secretStorePath(store);
  const backup = secretStoreBackupPath(store);
  let json: unknown;
  try {
    json = readStore(store);
  } catch (err) {
    return { store, outcome: "failed", error: (err as Error).message };
  }
  if (json === undefined) {
    return null;
  }
  const pending = STORES[store]
    .slots(json)
    .filter((s) => isLegacyBlob(s.get()));
  if (pending.length === 0) {
    // A run that died after the rename left its backup behind.
    fs.rmSync(backup, { force: true });

    return { store, outcome: "already" };
  }
  if (!legacy?.isAvailable() || !current.isAvailable()) {
    return { store, outcome: "failed", error: "secret storage unavailable" };
  }

  const expected = new Map<string, string>();
  const errors: string[] = [];
  for (const slot of pending) {
    try {
      const plaintext = legacy.decrypt(Buffer.from(slot.get(), "base64"));
      const sealed = current.encrypt(plaintext);
      if (current.decrypt(sealed) !== plaintext) {
        throw new Error("re-encrypted blob did not read back");
      }
      const b64 = sealed.toString("base64");
      slot.set(b64);
      expected.set(b64, plaintext);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  // All or nothing: a store is never left half on each scheme.
  if (errors.length > 0) {
    return { store, outcome: "failed", error: errors.join("; ") };
  }

  let replaced = false;
  try {
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, 0o600);
    writeAtomically(file, JSON.stringify(json, null, 2));
    replaced = true;
    const written = STORES[store].slots(readStore(store));
    const verified = [...expected].every(([b64, plaintext]) =>
      written.some(
        (s) =>
          s.get() === b64 &&
          current.decrypt(Buffer.from(b64, "base64")) === plaintext,
      ),
    );
    if (!verified) {
      throw new Error("rewritten store did not read back");
    }
  } catch (err) {
    // Before the rename the original is still in place, untouched.
    if (replaced) {
      fs.renameSync(backup, file);
    }

    return { store, outcome: "failed", error: (err as Error).message };
  }
  fs.rmSync(backup, { force: true });

  return { store, outcome: "migrated" };
}

/** Stores this run keeps on `safeStorage` because moving them failed. */
const onLegacy = new Set<SecretStoreId>();

/**
 * Whether `store` is read and written with the legacy `safeStorage` this run:
 * its move failed, or the shared scheme can't reach its key at all.
 */
export function usesLegacySecretStorage(store: SecretStoreId): boolean {
  const { legacySecretStorage, secretStorage } = hostPlatform();

  return (
    legacySecretStorage !== undefined &&
    (onLegacy.has(store) || !secretStorage.isAvailable())
  );
}

/** The cipher `store` reads and writes with on this host, this run. */
export function secretStorageFor(store: SecretStoreId): SecretStorage {
  const { legacySecretStorage: legacy, secretStorage: current } =
    hostPlatform();
  if (!legacy || !usesLegacySecretStorage(store)) {
    return current;
  }

  return {
    isAvailable: () => legacy.isAvailable(),
    // Old format, so the file stays whole until a later launch moves it.
    encrypt: (plaintext) => legacy.encrypt(plaintext),
    decrypt: (blob) =>
      isNodeSecretBlob(blob) ? current.decrypt(blob) : legacy.decrypt(blob),
  };
}

/** Test-only: forget which stores fell back. */
export function resetLegacySecretFallback(): void {
  onLegacy.clear();
}

/**
 * Re-seal every `safeStorage` blob with `current`. Idempotent: a store with
 * nothing left to move reports `already`, a missing store reports nothing. A
 * store that fails is left untouched and stays on `safeStorage` until the next
 * launch tries again.
 */
export function migrateLegacySecretStores(
  legacy: SecretStorage | undefined,
  current: SecretStorage,
): SecretStoreMigration[] {
  const results = SECRET_STORE_IDS.map((store) =>
    migrateStore(store, legacy, current),
  ).filter((m) => m !== null);
  for (const { store, outcome } of results) {
    if (outcome === "failed") {
      onLegacy.add(store);
    } else {
      onLegacy.delete(store);
    }
  }

  return results;
}
