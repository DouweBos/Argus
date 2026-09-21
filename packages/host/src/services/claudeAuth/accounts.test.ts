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
  envForAccount,
  getActiveAccountId,
  getClaudeAccount,
  listClaudeAccounts,
  noteAuthFailure,
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
      ).toBe(true);
      expect(getClaudeAccount("one")?.needs_reauth).toBe(true);
      expect(noteAuthFailure("one", "OAuth session expired")).toBe(false);
    });

    it("ignores ordinary output and clears on a fresh sign-in", () => {
      upsertClaudeAccount({ id: "one" });

      expect(noteAuthFailure("one", "npm warn deprecated")).toBe(false);
      noteAuthFailure("one", "Failed to authenticate");
      clearAuthFailure("one");

      expect(getClaudeAccount("one")?.needs_reauth).toBe(false);
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
