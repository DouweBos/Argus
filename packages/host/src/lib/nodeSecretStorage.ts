/**
 * The host's one secret storage scheme, used by every Argus host on a home:
 * Electron (desktop and Argus Server.app), the Mac app's bundled host and
 * `argus-host`, so any of them can read what another wrote.
 *
 * A random AES-256-GCM key lives in the macOS login keychain (via the
 * `security` CLI), or in a 0600 file under `ARGUS_HOME` elsewhere — and for a
 * home in a temp dir, whose keychain item would outlive it (one that already
 * has a keychain key moves it into the file). Blobs are
 * tagged so one written by Electron's `safeStorage` fails to decrypt loudly
 * rather than yielding garbage.
 */

import type { SecretStorage } from "../platform";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { argusHomeDir } from "./argusHome";
import { canonicalPath } from "./canonicalPath";

const MAGIC = Buffer.from("ah1");

/** Whether a blob was sealed by this scheme rather than Electron's `safeStorage`. */
export function isNodeSecretBlob(blob: Buffer): boolean {
  return blob.subarray(0, MAGIC.length).equals(MAGIC);
}

export const KEYCHAIN_SERVICE = "Argus Host Secret Storage";

export interface KeychainTool {
  /** The `security` binary. */
  command: string;
  /** A keychain prompt must never block the host for good. */
  timeoutMs: number;
}

/**
 * By absolute path: the item's ACL trusts `/usr/bin/security` itself, so any
 * host (Electron, the Mac app's `node`, `argus-host`) reads it without a prompt.
 */
const SECURITY: KeychainTool = {
  command: process.platform === "darwin" ? "/usr/bin/security" : "security",
  timeoutMs: 10_000,
};

/** One key per state directory, so a dev host never shares one with prod. */
export function keychainAccount(home = argusHomeDir()): string {
  // Normalised so `~/.argus/` from one app and `~/.argus` from another agree.
  return path.resolve(home);
}

/**
 * The login keychain, named outright: `security` finds the default one through
 * `HOME`, and under any other `HOME` it has none and waits on a prompt.
 */
export function loginKeychainArgs(): string[] {
  const keychain = path.join(
    os.userInfo().homedir,
    "Library",
    "Keychains",
    "login.keychain-db",
  );

  return fs.existsSync(keychain) ? [keychain] : [];
}

function readKeychainKey(tool: KeychainTool): Buffer | null {
  try {
    const out = execFileSync(
      tool.command,
      [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        keychainAccount(),
        "-w",
        ...loginKeychainArgs(),
      ],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: tool.timeoutMs,
      },
    ).trim();

    return out ? Buffer.from(out, "base64") : null;
  } catch {
    return null;
  }
}

function writeKeychainKey(tool: KeychainTool, key: Buffer): boolean {
  const quote = (v: string) => `"${v.replace(/(["\\])/g, "\\$1")}"`;
  // Fed over stdin (`security -i`) so the key never shows up in `ps`.
  const command = [
    "add-generic-password",
    "-U",
    "-s",
    quote(KEYCHAIN_SERVICE),
    "-a",
    quote(keychainAccount()),
    "-w",
    quote(key.toString("base64")),
    ...loginKeychainArgs().map(quote),
  ].join(" ");
  try {
    execFileSync(tool.command, ["-i"], {
      input: `${command}\n`,
      stdio: ["pipe", "ignore", "ignore"],
      timeout: tool.timeoutMs,
    });

    return readKeychainKey(tool)?.equals(key) ?? false;
  } catch {
    return false;
  }
}

function keyFilePath(): string {
  return path.join(argusHomeDir(), "secret-storage.key");
}

function readFileKey(): Buffer | null {
  try {
    return Buffer.from(
      fs.readFileSync(keyFilePath(), "utf-8").trim(),
      "base64",
    );
  } catch {
    return null;
  }
}

function writeFileKey(key: Buffer): boolean {
  try {
    fs.mkdirSync(argusHomeDir(), { recursive: true });
    fs.writeFileSync(keyFilePath(), key.toString("base64"), { mode: 0o600 });

    return true;
  } catch {
    return false;
  }
}

export type SecretKeyBackend = "file" | "keychain";

/** Loads the key, minting one on first use. Null when nowhere can hold it. */
function loadOrCreateKey(
  backend: SecretKeyBackend,
  tool: KeychainTool,
): Buffer | null {
  const useKeychain = backend === "keychain";
  const existing = useKeychain ? readKeychainKey(tool) : readFileKey();
  if (existing?.length === 32) {
    return existing;
  }
  // A temp home made before keys moved to the file has its secrets sealed
  // with a keychain key; adopt that key, or they never decrypt again.
  if (!useKeychain && process.platform === "darwin") {
    const legacy = readKeychainKey(tool);
    if (legacy?.length === 32) {
      writeFileKey(legacy);

      return legacy;
    }
  }
  const key = crypto.randomBytes(32);
  const stored = useKeychain ? writeKeychainKey(tool, key) : writeFileKey(key);

  return stored ? key : null;
}

/** A test or scratch host: its state is meant to vanish with the folder. */
export function isTempArgusHome(home = argusHomeDir()): boolean {
  const real = canonicalPath(home);

  return [os.tmpdir(), "/tmp"].some((dir) => {
    const rel = path.relative(canonicalPath(dir), real);

    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

export function defaultSecretKeyBackend(): SecretKeyBackend {
  return process.platform === "darwin" && !isTempArgusHome()
    ? "keychain"
    : "file";
}

export function nodeSecretStorage(
  backend: SecretKeyBackend = defaultSecretKeyBackend(),
  tool: KeychainTool = SECURITY,
): SecretStorage {
  let key: Buffer | null | undefined;
  const getKey = (): Buffer | null => {
    if (key === undefined) {
      key = loadOrCreateKey(backend, tool);
    }

    return key;
  };
  const requireKey = (): Buffer => {
    const k = getKey();
    if (!k) {
      throw new Error("secret storage is unavailable");
    }

    return k;
  };

  return {
    isAvailable: () => getKey() !== null,
    encrypt: (plaintext) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", requireKey(), iv);
      const body = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);

      return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
    },
    decrypt: (ciphertext) => {
      if (!isNodeSecretBlob(ciphertext)) {
        throw new Error("not written by this host's secret storage");
      }
      const iv = ciphertext.subarray(3, 15);
      const tag = ciphertext.subarray(15, 31);
      const decipher = crypto.createDecipheriv("aes-256-gcm", requireKey(), iv);
      decipher.setAuthTag(tag);

      return Buffer.concat([
        decipher.update(ciphertext.subarray(31)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
