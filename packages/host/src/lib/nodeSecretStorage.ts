/**
 * Secret storage for a host running as plain Node, where Electron's
 * `safeStorage` doesn't exist.
 *
 * A random AES-256-GCM key lives in the macOS login keychain (via the
 * `security` CLI), or in a 0600 file under `ARGUS_HOME` elsewhere. Blobs are
 * tagged so one written by Electron's `safeStorage` fails to decrypt loudly
 * rather than yielding garbage.
 */

import type { SecretStorage } from "../platform";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "./argusHome";

const MAGIC = Buffer.from("ah1");
const KEYCHAIN_SERVICE = "Argus Host Secret Storage";

function keychainAccount(): string {
  // One key per state directory, so a dev host never shares one with prod.
  return argusHomeDir();
}

function readKeychainKey(): Buffer | null {
  try {
    const out = execFileSync(
      "security",
      [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        keychainAccount(),
        "-w",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    return out ? Buffer.from(out, "base64") : null;
  } catch {
    return null;
  }
}

function writeKeychainKey(key: Buffer): boolean {
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
  ].join(" ");
  try {
    execFileSync("security", ["-i"], {
      input: `${command}\n`,
      stdio: ["pipe", "ignore", "ignore"],
    });

    return readKeychainKey()?.equals(key) ?? false;
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
function loadOrCreateKey(backend: SecretKeyBackend): Buffer | null {
  const useKeychain = backend === "keychain";
  const existing = useKeychain ? readKeychainKey() : readFileKey();
  if (existing?.length === 32) {
    return existing;
  }
  const key = crypto.randomBytes(32);
  const stored = useKeychain ? writeKeychainKey(key) : writeFileKey(key);

  return stored ? key : null;
}

export function nodeSecretStorage(
  backend: SecretKeyBackend = process.platform === "darwin"
    ? "keychain"
    : "file",
): SecretStorage {
  let key: Buffer | null | undefined;
  const getKey = (): Buffer | null => {
    if (key === undefined) {
      key = loadOrCreateKey(backend);
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
      if (!ciphertext.subarray(0, MAGIC.length).equals(MAGIC)) {
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
