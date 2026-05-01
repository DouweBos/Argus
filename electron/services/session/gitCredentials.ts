/**
 * Phase 7 T5 — credential helper polish.
 *
 * - `checkSshKeys` reads `~/.ssh/` for `id_*` files (excluding `.pub`) and
 *   classifies them by filename pattern. Used by `RemotesView` to render an
 *   inline warning when the user has no keys for an SSH remote.
 * - `setGlobalCredentialHelper` wires the macOS keychain (`osxkeychain`) or a
 *   plaintext store as the global HTTPS credential helper.
 *
 * Both endpoints are read-only / global-config-only — no `withGitLock`,
 * no scope gating.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GitError } from "./gitError";

const execFileAsync = promisify(execFile);

export type SshKeyType = "dsa" | "ecdsa" | "ed25519" | "other" | "rsa";

export interface SshKey {
  name: string;
  type: SshKeyType;
}

function classifyKeyName(name: string): SshKeyType {
  const lower = name.toLowerCase();
  if (lower.includes("ed25519")) {
    return "ed25519";
  }
  if (lower.includes("ecdsa")) {
    return "ecdsa";
  }
  if (lower.includes("rsa")) {
    return "rsa";
  }
  if (lower.includes("dsa")) {
    return "dsa";
  }

  return "other";
}

export async function checkSshKeys(): Promise<{ keys: SshKey[] }> {
  const dir = path.join(os.homedir(), ".ssh");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { keys: [] };
  }
  const keys: SshKey[] = [];
  for (const name of entries) {
    if (!name.startsWith("id_")) {
      continue;
    }
    if (name.endsWith(".pub")) {
      continue;
    }
    keys.push({ name, type: classifyKeyName(name) });
  }
  keys.sort((a, b) => a.name.localeCompare(b.name));

  return { keys };
}

export async function setGlobalCredentialHelper(
  name: "osxkeychain" | "store",
): Promise<void> {
  if (name !== "osxkeychain" && name !== "store") {
    throw new GitError("unknown", `Unsupported credential helper: ${name}`);
  }
  try {
    await execFileAsync("git", [
      "config",
      "--global",
      "credential.helper",
      name,
    ]);
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new GitError(
      "unknown",
      e.stderr || e.message || "Failed to set credential helper",
    );
  }
}

/** Read-only — returns the configured global credential helper or `null`. */
export async function getGlobalCredentialHelper(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "config",
      "--global",
      "--get",
      "credential.helper",
    ]);

    return stdout.trim() || null;
  } catch {
    return null;
  }
}
