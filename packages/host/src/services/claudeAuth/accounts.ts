/**
 * Multiple signed-in Claude accounts, stored at `~/.argus/claude-accounts.json`.
 *
 * The Claude CLI namespaces its stored credentials by
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR`: the macOS keychain service becomes
 * `Claude Code-credentials-<sha256(dir)[0:8]>` (with a `<dir>/.credentials.json`
 * fallback). It namespaces *credentials only*.
 *
 * Each account therefore owns a directory under
 * `~/.argus/claude-accounts/<id>/` used purely as that namespace. Because the
 * keychain service name hashes the absolute path, moving `~/.argus` invalidates
 * saved logins — the user re-authenticates, nothing else breaks.
 *
 * Credentials alone aren't enough, though: the CLI keeps the signed-in identity
 * (`oauthAccount` — email, org, billing) in `.claude.json`, which is *not*
 * namespaced by that variable. Sharing one `.claude.json` across accounts means
 * every run but the most recent login's carries another account's org, which
 * breaks token refresh and misreports who is signed in. So each account also
 * gets its own `CLAUDE_CONFIG_DIR` at `<id>/config/`, holding a real
 * `.claude.json` plus symlinks back to everything in `~/.claude` (settings,
 * CLAUDE.md, plugins, `projects/` transcripts) so the rest stays shared.
 *
 * The reserved id `default` sets no env var at all, i.e. it is whatever account
 * `claude` was already logged into before Argus grew this feature.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";

const execFileAsync = promisify(execFile);

const SCHEMA_VERSION = 1;
const CLAUDE_BIN = "claude";
const CREDENTIAL_ENV = "CLAUDE_SECURESTORAGE_CONFIG_DIR";
const CONFIG_ENV = "CLAUDE_CONFIG_DIR";

/** Id of the pre-existing `~/.claude` login. Sets no credential env var. */
export const DEFAULT_ACCOUNT_ID = "default";

export interface ClaudeAccount {
  id: string;
  /** User-editable display name. Falls back to the email when unset. */
  label?: string;
  email?: string;
  org_id?: string;
  org_name?: string;
  subscription_type?: string;
  auth_method?: string;
  /** Set when a run failed to authenticate — the row offers a re-login. */
  needs_reauth?: boolean;
  /** Set when a run hit the plan's usage limit — credentials are fine. */
  rate_limited?: boolean;
  account_type: "claudeai" | "console";
  created_at: number;
}

interface ClaudeAccountsFile {
  version: number;
  active_id: string;
  accounts: ClaudeAccount[];
}

function filePath(): string {
  return path.join(argusHomeDir(), "claude-accounts.json");
}

function emptyFile(): ClaudeAccountsFile {
  return {
    version: SCHEMA_VERSION,
    active_id: DEFAULT_ACCOUNT_ID,
    accounts: [],
  };
}

function readFile(): ClaudeAccountsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return emptyFile();
  }

  try {
    const parsed = JSON.parse(raw) as ClaudeAccountsFile;
    if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.accounts)) {
      return emptyFile();
    }

    return {
      version: SCHEMA_VERSION,
      active_id: parsed.active_id || DEFAULT_ACCOUNT_ID,
      accounts: parsed.accounts,
    };
  } catch (e) {
    warn("Failed to parse claude-accounts.json:", e);

    return emptyFile();
  }
}

function writeFile(file: ClaudeAccountsFile): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

function accountsRootDir(): string {
  return path.join(argusHomeDir(), "claude-accounts");
}

/** Directory whose path seeds the CLI's credential namespace for an account. */
export function accountCredentialDir(id: string): string {
  return path.join(accountsRootDir(), id);
}

/** This account's `CLAUDE_CONFIG_DIR` — its own `.claude.json` lives here. */
export function accountConfigDir(id: string): string {
  return path.join(accountCredentialDir(id), "config");
}

function sharedClaudeDir(): string {
  return path.join(os.homedir(), ".claude");
}

/**
 * Entries that must stay per-account even though `~/.claude` has them. Sharing
 * `.credentials.json` would hand every account the same token — the keychain
 * fallback for a namespaced store — and `.oauth_refresh.lock` would make two
 * accounts skip each other's token refresh.
 */
const NEVER_SHARED = new Set([".credentials.json", ".oauth_refresh.lock"]);

/**
 * Create the account's config dir and keep it linked to the shared `~/.claude`.
 * `.claude.json` is seeded from the user's own (minus the identity) so the
 * account doesn't start at onboarding; the CLI refills `oauthAccount` from the
 * account's token on its first run.
 */
export function ensureAccountConfigDir(id: string): string {
  const dir = accountConfigDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const configFile = path.join(dir, ".claude.json");
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, seedConfigJson(), "utf8");
  }

  // Link (never copy) the shared config so settings, CLAUDE.md, plugins and the
  // `projects/` transcripts Argus forks stay one set of files.
  let entries: string[];
  try {
    entries = fs.readdirSync(sharedClaudeDir());
  } catch {
    return dir;
  }
  for (const entry of entries) {
    const target = path.join(dir, entry);
    // Drop links an older Argus left behind, so an account that had its token
    // or refresh lock shared stops sharing it.
    if (NEVER_SHARED.has(entry)) {
      if (isSymlink(target)) {
        fs.rmSync(target, { force: true });
      }
      continue;
    }
    if (fs.existsSync(target) || isSymlink(target)) {
      continue;
    }
    try {
      fs.symlinkSync(path.join(sharedClaudeDir(), entry), target);
    } catch (e) {
      warn(`[claudeAccounts] linking ${entry} into ${dir} failed:`, e);
    }
  }

  return dir;
}

/** `existsSync` follows links, so a dangling one needs its own check. */
function isSymlink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function seedConfigJson(): string {
  try {
    const raw = fs.readFileSync(
      path.join(os.homedir(), ".claude.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    Reflect.deleteProperty(parsed, "oauthAccount");

    return JSON.stringify(parsed, null, 2);
  } catch {
    return "{}";
  }
}

/**
 * Env overlay that points the Claude CLI at this account's credentials and
 * config. Empty for the default account, which uses the CLI's own stores.
 */
export function claudeAccountEnv(id: string): Record<string, string> {
  // An id we don't know is a removed account — pointing the CLI at its
  // namespace would recreate an empty one and every run would 401.
  if (id === DEFAULT_ACCOUNT_ID || !getClaudeAccount(id)) {
    return {};
  }

  return {
    [CREDENTIAL_ENV]: accountCredentialDir(id),
    [CONFIG_ENV]: ensureAccountConfigDir(id),
  };
}

/**
 * Build a child env for the given account. Always clears the inherited
 * credential and config vars first so the default account doesn't silently pick
 * up the globally active one.
 */
export function envForAccount(
  id: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of [CREDENTIAL_ENV, CONFIG_ENV]) {
    // Only ours — a value the user set themselves is theirs to keep.
    if (env[key]?.startsWith(accountsRootDir())) {
      Reflect.deleteProperty(env, key);
    }
  }

  return Object.assign(env, claudeAccountEnv(id));
}

/**
 * CLI output that means the stored credentials are dead. `auth status` still
 * reports these accounts as signed in — it only checks that tokens exist — so a
 * failed run is the only signal that a re-login is needed.
 */
const AUTH_FAILURE =
  /OAuth (?:token|session) expired|(?:token|credentials) (?:has|have) been revoked|could not be refreshed|Failed to authenticate|invalid_grant|invalid_api_key|authentication_error|Could not resolve authentication method|Please run [`"]?\/login/i;

/**
 * CLI output meaning the plan's usage limit is spent. Distinct from an auth
 * failure: the credentials work, the quota doesn't. Some CLIs append a
 * "run /login" hint to this text, which is why the rate limit is matched first.
 * The 429 alternatives stay contextual — bare `429` would match a port or a
 * byte count on the debug output this runs against.
 */
const RATE_LIMIT =
  /weekly limit|usage limit|rate.?limit exceeded|hit your (?:weekly|hourly|daily|monthly|session) limit|too many requests|(?:status|error|code)[ ="-]*429\b/i;

/**
 * What one CLI run with an account's credentials says about it. `unknown` means
 * the output said nothing about auth — offline, a crash, an unrelated error — so
 * it must not move any flags either way.
 */
export type AuthOutcome = "ok" | "rate_limited" | "reauth" | "unknown";

/**
 * Read a failing run's output. Rate limit wins when text matches both: the
 * quota error often carries a "run /login" hint, and sending the user to
 * re-login for a full quota would be a wild goose chase.
 */
export function classifyRunFailure(text: string): AuthOutcome {
  if (RATE_LIMIT.test(text)) {
    return "rate_limited";
  }
  if (AUTH_FAILURE.test(text)) {
    return "reauth";
  }

  return "unknown";
}

/**
 * Read one stream-json line, trusting only the CLI's own error envelopes. Tool
 * results and assistant text quote arbitrary content — an agent grepping this
 * file would otherwise flag its own account as limited.
 */
export function classifyStreamLine(line: string): AuthOutcome {
  let msg: {
    type?: unknown;
    error?: unknown;
    is_error?: unknown;
    result?: unknown;
  };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return "unknown";
  }
  if (msg.type === "assistant") {
    if (msg.error === "rate_limit") {
      return "rate_limited";
    }

    return msg.error === "authentication_failed" ? "reauth" : "unknown";
  }
  if (msg.type === "result" && msg.is_error === true) {
    return classifyRunFailure(typeof msg.result === "string" ? msg.result : "");
  }

  return "unknown";
}

/**
 * Record what a run or probe found, so the switcher badges and the auth prereq
 * can't disagree about an account. `ok` clears stale badges — a limit from
 * yesterday's run shouldn't outlive the quota reset — while `unknown` changes
 * nothing. Returns true when a badge actually moved, so callers only notify the
 * UI when there's something new to see.
 */
export function recordAuthOutcome(id: string, outcome: AuthOutcome): boolean {
  if (outcome === "unknown") {
    return false;
  }

  const account = getClaudeAccount(id);
  if (!account) {
    return false;
  }

  const flags = {
    needs_reauth: outcome === "reauth",
    rate_limited: outcome === "rate_limited",
  };
  if (
    account.needs_reauth === flags.needs_reauth &&
    account.rate_limited === flags.rate_limited
  ) {
    return false;
  }

  upsertClaudeAccount({ id, ...flags });

  return true;
}

/** Clear both run-failure flags once the account works again. */
export function clearAuthFailure(id: string): void {
  recordAuthOutcome(id, "ok");
}

/**
 * Accounts to run on, in order, starting from `preferredId`. Already
 * rate-limited ones go last rather than out — the flag may predate the reset —
 * while ones needing a re-login can't run at all.
 */
export function accountFallbackOrder(preferredId: string): string[] {
  const rank = (a: ClaudeAccount): number =>
    (a.rate_limited ? 2 : 0) + (a.id === preferredId ? 0 : 1);
  const usable = listClaudeAccounts()
    .filter((a) => !a.needs_reauth)
    .sort((a, b) => rank(a) - rank(b))
    .map((a) => a.id);

  return usable.length > 0 ? usable : [preferredId];
}

export function listClaudeAccounts(): ClaudeAccount[] {
  return readFile().accounts;
}

/**
 * Re-read every account's identity from its own config before listing. Reading
 * a local file is cheap enough to do on every fetch, which keeps the switcher
 * honest when something outside Argus — a plain `claude` login in a terminal —
 * rewrites the default account's identity underneath us.
 */
export function refreshAllAccountIdentities(): ClaudeAccount[] {
  for (const account of readFile().accounts) {
    const fields = identityFromConfig(account.id);
    const changed = Object.entries(fields).some(
      ([key, value]) =>
        value !== undefined && account[key as keyof ClaudeAccount] !== value,
    );
    if (changed) {
      upsertClaudeAccount({ id: account.id, ...fields });
    }
  }

  return listClaudeAccounts();
}

export function getActiveAccountId(): string {
  const file = readFile();
  const exists = file.accounts.some((a) => a.id === file.active_id);

  return exists ? file.active_id : DEFAULT_ACCOUNT_ID;
}

export function getClaudeAccount(id: string): ClaudeAccount | undefined {
  return readFile().accounts.find((a) => a.id === id);
}

/**
 * Point the main process (and everything inheriting its env — one-shot `claude
 * -p` calls, prereq checks, terminals) at the active account.
 */
export function applyActiveAccountToProcessEnv(): void {
  const env = claudeAccountEnv(getActiveAccountId());
  for (const key of [CREDENTIAL_ENV, CONFIG_ENV]) {
    const dir = env[key];
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      process.env[key] = dir;
    } else if (process.env[key]?.startsWith(accountsRootDir())) {
      Reflect.deleteProperty(process.env, key);
    }
  }
}

export function setActiveAccount(id: string): ClaudeAccountsFile {
  const file = readFile();
  if (!file.accounts.some((a) => a.id === id)) {
    throw `Unknown Claude account: ${id}`;
  }
  file.active_id = id;
  writeFile(file);
  applyActiveAccountToProcessEnv();

  return file;
}

/** Insert or merge an account entry, keyed by id. */
export function upsertClaudeAccount(
  account: Partial<ClaudeAccount> & { id: string },
): ClaudeAccount {
  const file = readFile();
  const index = file.accounts.findIndex((a) => a.id === account.id);
  const merged: ClaudeAccount = {
    account_type: "claudeai",
    created_at: Date.now(),
    ...(index >= 0 ? file.accounts[index] : {}),
    ...account,
  };

  if (index >= 0) {
    file.accounts[index] = merged;
  } else {
    file.accounts.push(merged);
  }
  writeFile(file);

  return merged;
}

export function renameClaudeAccount(id: string, label: string): ClaudeAccount {
  const trimmed = label.trim();

  return upsertClaudeAccount({ id, label: trimmed || undefined });
}

/**
 * Identity as the CLI itself records it, in the account's own `.claude.json`.
 * Preferred over `auth status`, which on recent CLIs reports no identity at all
 * — leaving a row showing whatever email was captured at seed time even after
 * the account became someone else.
 */
function identityFromConfig(id: string): Partial<ClaudeAccount> {
  const file =
    id === DEFAULT_ACCOUNT_ID
      ? path.join(os.homedir(), ".claude.json")
      : path.join(accountConfigDir(id), ".claude.json");

  let account: Record<string, unknown>;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    account = (parsed.oauthAccount ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }

  const str = (key: string): string | undefined =>
    typeof account[key] === "string" ? (account[key] as string) : undefined;

  const subscription = str("organizationType");

  return {
    email: str("emailAddress"),
    org_id: str("organizationUuid"),
    org_name: str("organizationName"),
    // `claude_team`/`claude_max` → `team`/`max`, matching the CLI's own values.
    subscription_type: subscription?.replace(/^claude_/, ""),
  };
}

/**
 * Read an account's identity and persist it on the entry, so the switcher shows
 * who the account is *now* rather than who was first seen in it. Falls back to
 * `auth status` only for fields the config doesn't carry.
 */
export async function syncAccountIdentity(
  id: string,
): Promise<ClaudeAccount | null> {
  const fromConfig = identityFromConfig(id);

  let parsed: Record<string, unknown> | null = null;
  try {
    const { stdout } = await execFileAsync(
      CLAUDE_BIN,
      ["auth", "status", "--json"],
      { timeout: 12_000, env: envForAccount(id) },
    );
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    // CLI missing or errored — the config file still tells us who it is.
  }

  const loggedIn = parsed?.loggedIn === true || Boolean(fromConfig.email);
  if (!loggedIn) {
    return null;
  }

  const statusStr = (key: string): string | undefined => {
    const value = parsed?.[key];

    return typeof value === "string" ? value : undefined;
  };

  // Keep what we already know for fields neither source has yet.
  const fields: Partial<ClaudeAccount> = {
    ...fromConfig,
    auth_method: statusStr("authMethod"),
  };

  return upsertClaudeAccount({
    id,
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)),
  });
}

/**
 * Log out of an account and forget it: drops the CLI credentials for its
 * namespace, removes the directory, and picks a new active account if needed.
 * The default account is logged out but kept in the list — it represents the
 * CLI's own store, which always exists.
 */
export async function removeClaudeAccount(
  id: string,
  opts: { logout?: boolean } = {},
): Promise<void> {
  // `auth logout` revokes the token server-side. Skip it for an account that
  // never authenticated — there is nothing of its own to revoke, and the CLI
  // would fall back to the shared store and kill a live login instead.
  if (opts.logout ?? true) {
    try {
      await execFileAsync(CLAUDE_BIN, ["auth", "logout"], {
        timeout: 12_000,
        env: envForAccount(id),
      });
    } catch (e) {
      // Already logged out, or the CLI is missing — the entry still goes.
      warn(`[claudeAccounts] logout for ${id} failed:`, e);
    }
  }

  if (id !== DEFAULT_ACCOUNT_ID) {
    fs.rmSync(accountCredentialDir(id), { force: true, recursive: true });
  }

  const file = readFile();
  file.accounts = file.accounts.filter((a) => a.id !== id);
  if (file.active_id === id) {
    file.active_id = file.accounts[0]?.id ?? DEFAULT_ACCOUNT_ID;
  }
  writeFile(file);
  applyActiveAccountToProcessEnv();
}

/** Mint an id and directory for a not-yet-authenticated account. */
export function createPendingAccount(
  accountType: "claudeai" | "console",
): ClaudeAccount {
  const id = crypto.randomUUID();
  fs.mkdirSync(accountCredentialDir(id), { recursive: true });

  return upsertClaudeAccount({ id, account_type: accountType });
}

/**
 * Collapse a freshly authenticated account onto an existing entry with the same
 * email — logging in twice as the same person replaces the older credentials
 * rather than listing them twice. Returns the id that survived.
 */
export async function dedupeAccountByEmail(id: string): Promise<string> {
  const synced = await syncAccountIdentity(id);
  if (!synced?.email) {
    return id;
  }

  const duplicate = listClaudeAccounts().find(
    (a) => a.id !== id && a.email === synced.email,
  );
  if (!duplicate) {
    return id;
  }

  const file = readFile();
  const wasActive =
    file.active_id === duplicate.id || file.active_id === synced.id;
  file.accounts = file.accounts.filter((a) => a.id !== duplicate.id);
  if (wasActive) {
    file.active_id = id;
  }
  writeFile(file);

  if (duplicate.id !== DEFAULT_ACCOUNT_ID) {
    fs.rmSync(accountCredentialDir(duplicate.id), {
      force: true,
      recursive: true,
    });
  }
  applyActiveAccountToProcessEnv();

  return id;
}

/**
 * Adopt the pre-existing `claude` login as the `default` account on first run,
 * so upgrading users never have to re-authenticate.
 */
export async function ensureDefaultAccountSeeded(): Promise<void> {
  const file = readFile();
  if (file.accounts.length > 0) {
    return;
  }

  const seeded = upsertClaudeAccount({
    id: DEFAULT_ACCOUNT_ID,
    account_type: "claudeai",
  });
  setActiveAccount(seeded.id);

  // Drop the placeholder again if the CLI turns out not to be logged in.
  if (!(await syncAccountIdentity(DEFAULT_ACCOUNT_ID))) {
    const current = readFile();
    current.accounts = current.accounts.filter(
      (a) => a.id !== DEFAULT_ACCOUNT_ID,
    );
    writeFile(current);
  }
}

/** The account a session's agents and terminals should authenticate as. */
export function resolveAccountForSession(
  session: { claude_account_id?: string | null } | null | undefined,
): string {
  const pinned = session?.claude_account_id;
  if (pinned && listClaudeAccounts().some((a) => a.id === pinned)) {
    return pinned;
  }

  return getActiveAccountId();
}
