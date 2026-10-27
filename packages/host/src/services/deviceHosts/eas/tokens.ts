/**
 * Expo access tokens saved per EAS host, sealed with the host's secret storage
 * in `$ARGUS_HOME/eas-tokens.json`. Without OS-backed storage nothing is saved:
 * EXPO_TOKEN or `eas login` still work, and a token never sits in plain text.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../../lib/argusHome";
import { hostPlatform } from "../../../platform";

function filePath(): string {
  return path.join(argusHomeDir(), "eas-tokens.json");
}

function readAll(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as {
      tokens?: unknown;
    };
    if (parsed.tokens && typeof parsed.tokens === "object") {
      return Object.fromEntries(
        Object.entries(parsed.tokens).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      );
    }
  } catch {
    // Missing or unreadable: nothing saved.
  }

  return {};
}

function writeAll(tokens: Record<string, string>): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tokens }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, target);
}

/** The saved token, or "" when there is none or it can't be unsealed. */
export function readEasToken(hostId: string): string {
  const sealed = readAll()[hostId];
  if (!sealed) {
    return "";
  }
  try {
    return hostPlatform().secretStorage.decrypt(Buffer.from(sealed, "base64"));
  } catch {
    warn(`[eas] the saved token for ${hostId} can't be unsealed; ignoring it`);

    return "";
  }
}

export function hasEasToken(hostId: string): boolean {
  return Boolean(readAll()[hostId]);
}

/** Save, or with "" clear, a host's token. Throws a sentence when it can't be sealed. */
export function writeEasToken(hostId: string, token: string): void {
  const all = readAll();
  const trimmed = token.trim();
  if (!trimmed) {
    if (hostId in all) {
      writeAll(
        Object.fromEntries(Object.entries(all).filter(([id]) => id !== hostId)),
      );
    }

    return;
  }
  const storage = hostPlatform().secretStorage;
  if (!storage.isAvailable()) {
    throw "This machine has no secure storage for the token. Set EXPO_TOKEN for the Argus host or run `eas login` instead.";
  }
  all[hostId] = storage.encrypt(trimmed).toString("base64");
  writeAll(all);
}
