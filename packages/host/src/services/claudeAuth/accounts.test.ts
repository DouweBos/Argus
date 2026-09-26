import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accountConfigDir,
  accountCredentialDir,
  applyActiveAccountToProcessEnv,
  claudeAccountEnv,
  clearAuthFailure,
  DEFAULT_ACCOUNT_ID,
  ensureAccountConfigDir,
  envForAccount,
  getActiveAccountId,
  getClaudeAccount,
  listClaudeAccounts,
  noteAuthFailure,
  refreshAllAccountIdentities,
  resolveAccountForSession,
  setActiveAccount,
  upsertClaudeAccount,
} from "./accounts";

const CREDENTIAL_ENV = "CLAUDE_SECURESTORAGE_CONFIG_DIR";
const CONFIG_ENV = "CLAUDE_CONFIG_DIR";

let home: string;
let originalHome: string | undefined;
let originalCredentialEnv: string | undefined;
let originalConfigEnv: string | undefined;

// Isolate `~/.argus` per test so the store always starts empty.
describe("claude accounts", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-accounts-"));
    originalHome = process.env.ARGUS_HOME;
    originalCredentialEnv = process.env[CREDENTIAL_ENV];
    originalConfigEnv = process.env[CONFIG_ENV];
    process.env.ARGUS_HOME = home;
    Reflect.deleteProperty(process.env, CREDENTIAL_ENV);
    Reflect.deleteProperty(process.env, CONFIG_ENV);
  });

  afterEach(() => {
    if (originalHome === undefined) {
      Reflect.deleteProperty(process.env, "ARGUS_HOME");
    } else {
      process.env.ARGUS_HOME = originalHome;
    }
    if (originalCredentialEnv === undefined) {
      Reflect.deleteProperty(process.env, CREDENTIAL_ENV);
    } else {
      process.env[CREDENTIAL_ENV] = originalCredentialEnv;
    }
    if (originalConfigEnv === undefined) {
      Reflect.deleteProperty(process.env, CONFIG_ENV);
    } else {
      process.env[CONFIG_ENV] = originalConfigEnv;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  describe("claudeAccountEnv", () => {
    it("leaves the default account on the CLI's own credential store", () => {
      expect(claudeAccountEnv(DEFAULT_ACCOUNT_ID)).toEqual({});
    });

    it("namespaces other accounts by directory", () => {
      upsertClaudeAccount({ id: "abc" });

      expect(claudeAccountEnv("abc")).toEqual({
        [CREDENTIAL_ENV]: accountCredentialDir("abc"),
        [CONFIG_ENV]: accountConfigDir("abc"),
      });
    });

    it("gives the account its own .claude.json", () => {
      upsertClaudeAccount({ id: "abc" });
      claudeAccountEnv("abc");

      expect(
        fs.existsSync(path.join(accountConfigDir("abc"), ".claude.json")),
      ).toBe(true);
    });

    it("falls back to the CLI's store for a removed account", () => {
      expect(claudeAccountEnv("gone")).toEqual({});
      expect(fs.existsSync(accountCredentialDir("gone"))).toBe(false);
    });
  });

  // `os.homedir()` reads $HOME on POSIX, so redirecting it lets the sharing rule
  // be tested against a throwaway ~/.claude instead of the developer's own.
  describe("ensureAccountConfigDir sharing", () => {
    let fakeHome: string;
    let originalFakeHome: string | undefined;

    beforeEach(() => {
      fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "argus-home-"));
      originalFakeHome = process.env.HOME;
      process.env.HOME = fakeHome;
      fs.mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
      for (const entry of [
        ".claude.json",
        ".credentials.json",
        ".oauth_refresh.lock",
        "settings.json",
      ]) {
        fs.writeFileSync(path.join(fakeHome, ".claude", entry), "{}");
      }
    });

    afterEach(() => {
      if (originalFakeHome === undefined) {
        Reflect.deleteProperty(process.env, "HOME");
      } else {
        process.env.HOME = originalFakeHome;
      }
      fs.rmSync(fakeHome, { force: true, recursive: true });
    });

    it("links shared config but never the token or the refresh lock", () => {
      upsertClaudeAccount({ id: "abc" });
      const dir = ensureAccountConfigDir("abc");

      expect(
        fs.lstatSync(path.join(dir, "settings.json")).isSymbolicLink(),
      ).toBe(true);
      for (const entry of [".credentials.json", ".oauth_refresh.lock"]) {
        expect(fs.existsSync(path.join(dir, entry))).toBe(false);
      }
    });

    it("drops a token link an older Argus created", () => {
      upsertClaudeAccount({ id: "abc" });
      const dir = accountConfigDir("abc");
      fs.mkdirSync(dir, { recursive: true });
      fs.symlinkSync(
        path.join(fakeHome, ".claude", ".credentials.json"),
        path.join(dir, ".credentials.json"),
      );

      ensureAccountConfigDir("abc");

      expect(fs.existsSync(path.join(dir, ".credentials.json"))).toBe(false);
    });

    it("keeps a token the account minted itself", () => {
      upsertClaudeAccount({ id: "abc" });
      const dir = accountConfigDir("abc");
      fs.mkdirSync(dir, { recursive: true });
      const own = path.join(dir, ".credentials.json");
      fs.writeFileSync(own, "{}");

      ensureAccountConfigDir("abc");

      expect(fs.existsSync(own)).toBe(true);
    });
  });

  describe("envForAccount", () => {
    it("clears another account's namespace for the default account", () => {
      const env = envForAccount(DEFAULT_ACCOUNT_ID, {
        [CREDENTIAL_ENV]: accountCredentialDir("other"),
        [CONFIG_ENV]: accountConfigDir("other"),
        PATH: "/usr/bin",
      });

      expect(env[CREDENTIAL_ENV]).toBeUndefined();
      expect(env[CONFIG_ENV]).toBeUndefined();
      expect(env.PATH).toBe("/usr/bin");
    });

    it("leaves a config dir the user set themselves alone", () => {
      const env = envForAccount(DEFAULT_ACCOUNT_ID, {
        [CONFIG_ENV]: "/somewhere/else",
      });

      expect(env[CONFIG_ENV]).toBe("/somewhere/else");
    });

    it("overwrites an inherited namespace for a pinned account", () => {
      upsertClaudeAccount({ id: "abc" });
      const env = envForAccount("abc", { [CONFIG_ENV]: "/somewhere/else" });

      expect(env[CREDENTIAL_ENV]).toBe(accountCredentialDir("abc"));
      expect(env[CONFIG_ENV]).toBe(accountConfigDir("abc"));
    });
  });

  describe("account list", () => {
    it("round-trips accounts and the active id", () => {
      upsertClaudeAccount({ id: "one", email: "one@example.com" });
      upsertClaudeAccount({ id: "two", email: "two@example.com" });
      setActiveAccount("two");

      expect(listClaudeAccounts().map((a) => a.id)).toEqual(["one", "two"]);
      expect(getActiveAccountId()).toBe("two");
    });

    it("merges into an existing entry rather than duplicating it", () => {
      upsertClaudeAccount({ id: "one", email: "one@example.com" });
      upsertClaudeAccount({ id: "one", label: "Work" });

      const accounts = listClaudeAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        email: "one@example.com",
        label: "Work",
      });
    });

    it("falls back to the default when the active account is gone", () => {
      expect(getActiveAccountId()).toBe(DEFAULT_ACCOUNT_ID);
    });

    it("rejects an unknown active account", () => {
      expect(() => setActiveAccount("nope")).toThrow();
    });
  });

  describe("applyActiveAccountToProcessEnv", () => {
    it("sets the namespace for a non-default active account", () => {
      upsertClaudeAccount({ id: "one" });
      setActiveAccount("one");
      applyActiveAccountToProcessEnv();

      expect(process.env[CREDENTIAL_ENV]).toBe(accountCredentialDir("one"));
      expect(process.env[CONFIG_ENV]).toBe(accountConfigDir("one"));
    });

    it("clears the namespace for the default account", () => {
      upsertClaudeAccount({ id: DEFAULT_ACCOUNT_ID });
      process.env[CREDENTIAL_ENV] = accountCredentialDir("stale");
      setActiveAccount(DEFAULT_ACCOUNT_ID);
      applyActiveAccountToProcessEnv();

      expect(process.env[CREDENTIAL_ENV]).toBeUndefined();
    });
  });

  describe("noteAuthFailure", () => {
    it("flags the account once on an expired-session message", () => {
      upsertClaudeAccount({ id: "one" });

      expect(
        noteAuthFailure(
          "one",
          "OAuth session expired and could not be refreshed",
        ),
      ).toBe("reauth");
      expect(getClaudeAccount("one")?.needs_reauth).toBe(true);
      expect(noteAuthFailure("one", "OAuth session expired")).toBeNull();
    });

    it("ignores ordinary output and clears on a fresh sign-in", () => {
      upsertClaudeAccount({ id: "one" });

      expect(noteAuthFailure("one", "npm warn deprecated")).toBeNull();
      noteAuthFailure("one", "Failed to authenticate");
      clearAuthFailure("one");

      expect(getClaudeAccount("one")?.needs_reauth).toBe(false);
    });

    it("flags a spent quota as rate_limited, not needs_reauth", () => {
      upsertClaudeAccount({ id: "one" });

      expect(
        noteAuthFailure(
          "one",
          "You've hit your weekly limit · resets 6pm (Europe/Amsterdam)",
        ),
      ).toBe("rate_limit");
      const account = getClaudeAccount("one");
      expect(account?.rate_limited).toBe(true);
      expect(account?.needs_reauth).toBeUndefined();
    });

    it("prefers the quota reading when a limit error also says to log in", () => {
      upsertClaudeAccount({ id: "one" });

      expect(
        noteAuthFailure(
          "one",
          "429 Too Many Requests: usage limit exceeded. Please run `/login`",
        ),
      ).toBe("rate_limit");
      const account = getClaudeAccount("one");
      expect(account?.rate_limited).toBe(true);
      expect(account?.needs_reauth).toBeUndefined();
    });

    it("does not read a bare number as a status code", () => {
      upsertClaudeAccount({ id: "one" });

      expect(
        noteAuthFailure("one", "watching 4291 files, server on port 4290"),
      ).toBeNull();
      expect(getClaudeAccount("one")?.rate_limited).toBeUndefined();
    });

    it("clears both flags together once the account works", () => {
      upsertClaudeAccount({ id: "one" });
      noteAuthFailure("one", "Failed to authenticate");
      noteAuthFailure("one", "usage limit exceeded");

      clearAuthFailure("one");
      const account = getClaudeAccount("one");
      expect(account?.needs_reauth).toBe(false);
      expect(account?.rate_limited).toBe(false);
    });
  });

  describe("identityFromConfig", () => {
    it("reads who the account is from its own config", () => {
      upsertClaudeAccount({ id: "one" });
      const dir = accountConfigDir("one");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".claude.json"),
        JSON.stringify({
          oauthAccount: {
            emailAddress: "someone@example.com",
            organizationName: "Acme Inc",
            organizationType: "claude_team",
            organizationUuid: "org-1",
          },
        }),
      );

      expect(refreshAllAccountIdentities()).toEqual([
        expect.objectContaining({
          email: "someone@example.com",
          id: "one",
          org_name: "Acme Inc",
          subscription_type: "team",
        }),
      ]);
    });

    it("leaves a row alone when its config has no identity", () => {
      upsertClaudeAccount({ email: "stale@example.com", id: "one" });

      refreshAllAccountIdentities();

      expect(listClaudeAccounts()[0]?.email).toBe("stale@example.com");
    });
  });

  describe("resolveAccountForSession", () => {
    beforeEach(() => {
      upsertClaudeAccount({ id: "one" });
      upsertClaudeAccount({ id: "two" });
      setActiveAccount("one");
    });

    it("uses the pinned account", () => {
      expect(resolveAccountForSession({ claude_account_id: "two" })).toBe(
        "two",
      );
    });

    it("follows the active account when unpinned", () => {
      expect(resolveAccountForSession({ claude_account_id: null })).toBe("one");
      expect(resolveAccountForSession(null)).toBe("one");
    });

    it("ignores a pin to an account that no longer exists", () => {
      expect(resolveAccountForSession({ claude_account_id: "gone" })).toBe(
        "one",
      );
    });
  });
});
