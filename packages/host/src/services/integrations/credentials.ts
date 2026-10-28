/**
 * Integration credentials in `$ARGUS_HOME/integrations.json`. The secret is
 * sealed with the host's secret storage; the account it belongs to is not, so
 * Settings can show who is connected without unsealing anything.
 */

import type { IntegrationAccount, IntegrationId } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { hostPlatform } from "../../platform";

export interface StoredIntegration {
  method: "key" | "oauth";
  /** Base64 of the sealed secret. */
  sealed: string;
  account: IntegrationAccount;
  /** Set when the service rejected the credential; cleared on reconnect. */
  needsReauth?: boolean;
}

type Store = Partial<Record<IntegrationId, StoredIntegration>>;

function filePath(): string {
  return path.join(argusHomeDir(), "integrations.json");
}

function readAll(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as {
      integrations?: Store;
    };

    return parsed.integrations ?? {};
  } catch {
    return {};
  }
}

function writeAll(integrations: Store): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ integrations }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, target);
}

export function loadIntegration(id: IntegrationId): StoredIntegration | null {
  return readAll()[id] ?? null;
}

/** The unsealed secret, or null when there is none or it can't be unsealed. */
export function readSecret(id: IntegrationId): string | null {
  const entry = readAll()[id];
  if (!entry) {
    return null;
  }
  try {
    return hostPlatform().secretStorage.decrypt(
      Buffer.from(entry.sealed, "base64"),
    );
  } catch {
    warn(`[integrations] the saved ${id} credential can't be unsealed`);

    return null;
  }
}

/** Throws a sentence when the machine has nowhere safe to keep it. */
export function saveIntegration(
  id: IntegrationId,
  entry: {
    method: "key" | "oauth";
    secret: string;
    account: IntegrationAccount;
  },
): void {
  const storage = hostPlatform().secretStorage;
  if (!storage.isAvailable()) {
    throw "This machine has no secure storage to keep the credential in.";
  }
  const all = readAll();
  all[id] = {
    method: entry.method,
    sealed: storage.encrypt(entry.secret).toString("base64"),
    account: entry.account,
  };
  writeAll(all);
}

export function markNeedsReauth(id: IntegrationId): void {
  const all = readAll();
  const entry = all[id];
  if (!entry || entry.needsReauth) {
    return;
  }
  entry.needsReauth = true;
  writeAll(all);
}

export function deleteIntegration(id: IntegrationId): void {
  const all = readAll();
  if (!(id in all)) {
    return;
  }
  writeAll(
    Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)),
  );
}
