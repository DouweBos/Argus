/**
 * Where a secret the user typed into a `request_secret` card ends up: an
 * owner-only file that deletes itself, or a run command's environment held in
 * memory. Nothing here ever logs a value.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const MIN_TTL_MS = 60 * 1000;

let rootOverride: string | null = null;

export function setSecretsRootForTests(root: string | null): void {
  rootOverride = root;
}

function secretsRoot(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";

  return rootOverride ?? path.join(os.tmpdir(), `argus-secrets-${uid}`);
}

/** The private directory, refusing one somebody else made or a symlink. */
function ensureRoot(): string {
  const root = secretsRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  const ownUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (ownUid !== null && stat.uid !== ownUid)
  ) {
    throw `Refusing to store a secret in ${root}: it is not a private directory`;
  }
  fs.chmodSync(root, 0o700);

  return root;
}

function slug(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return s || "secret";
}

/** `<slug>.<expiresAtMs>.<random>` — the expiry rides in the name for the sweep. */
function expiryOf(file: string): number | null {
  const parts = file.split(".");
  const at = Number(parts.at(-2));

  return parts.length >= 3 && Number.isFinite(at) ? at : null;
}

const timers = new Map<string, NodeJS.Timeout>();

function scheduleDelete(file: string, ms: number): void {
  const timer = setTimeout(
    () => {
      timers.delete(file);
      fs.rmSync(file, { force: true });
    },
    Math.max(0, ms),
  );
  timer.unref();
  timers.set(file, timer);
}

export interface SecretFile {
  path: string;
  expiresAt: number;
}

export function writeSecretFile(
  label: string,
  value: string,
  ttlMs: number,
  now = Date.now(),
): SecretFile {
  const root = ensureRoot();
  sweepExpiredSecretFiles(now);
  const expiresAt = now + ttlMs;
  const name = `${slug(label)}.${expiresAt}.${crypto.randomBytes(6).toString("hex")}`;
  const file = path.join(root, name);
  fs.writeFileSync(file, value, { mode: 0o600, flag: "wx" });
  scheduleDelete(file, ttlMs);

  return { path: file, expiresAt };
}

/** Delete files left by an earlier run that outlived their TTL. */
export function sweepExpiredSecretFiles(now = Date.now()): number {
  const root = secretsRoot();
  let removed = 0;
  let files: string[];
  try {
    files = fs.readdirSync(root);
  } catch {
    return 0;
  }
  for (const name of files) {
    const at = expiryOf(name);
    // Anything unrecognised is ours too, and no secret lives past the cap.
    if (at === null || at <= now || at > now + MAX_TTL_MS) {
      fs.rmSync(path.join(root, name), { force: true });
      removed++;
    }
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Run command environment
// ---------------------------------------------------------------------------

interface EnvEntry {
  value: string;
  expiresAt: number;
}

/** sessionId → run title → variable → value. Memory only, gone on restart. */
const runEnv = new Map<string, Map<string, Map<string, EnvEntry>>>();

export function setRunSecretEnv(
  sessionId: string,
  runTitle: string,
  name: string,
  value: string,
  ttlMs: number,
  now = Date.now(),
): number {
  let byTitle = runEnv.get(sessionId);
  if (!byTitle) {
    byTitle = new Map();
    runEnv.set(sessionId, byTitle);
  }
  let vars = byTitle.get(runTitle);
  if (!vars) {
    vars = new Map();
    byTitle.set(runTitle, vars);
  }
  const expiresAt = now + ttlMs;
  vars.set(name, { value, expiresAt });

  return expiresAt;
}

/** The unexpired secrets a run command starts with. */
export function runSecretEnv(
  sessionId: string,
  runTitle: string,
  now = Date.now(),
): Record<string, string> {
  const vars = runEnv.get(sessionId)?.get(runTitle);
  const out: Record<string, string> = {};
  if (!vars) {
    return out;
  }
  for (const [name, entry] of vars) {
    if (entry.expiresAt <= now) {
      vars.delete(name);
    } else {
      out[name] = entry.value;
    }
  }

  return out;
}

export function forgetSessionSecrets(sessionId: string): void {
  runEnv.delete(sessionId);
}

export function resetVaultForTests(): void {
  runEnv.clear();
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
}
