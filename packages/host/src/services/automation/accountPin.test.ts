import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertClaudeAccount } from "../claudeAuth/accounts";
import {
  accountPinError,
  accountPinState,
  runAccountOrder,
} from "./accountPin";

let home: string;
let previousHome: string | undefined;

describe("automation account pin", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-account-pin-"));
    process.env.ARGUS_HOME = home;
    upsertClaudeAccount({ id: "personal", account_type: "claudeai" });
    upsertClaudeAccount({
      id: "work",
      account_type: "claudeai",
      email: "me@work.example",
    });
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  describe("runAccountOrder", () => {
    const base = {
      sessionAccountId: "personal",
      retryOtherAccounts: true,
      defaultRunner: true,
    };

    it("never leaves a pinned account, even when retries are on", () => {
      expect(runAccountOrder({ ...base, pinnedId: "work" })).toEqual(["work"]);
    });

    it("falls back across accounts only when unpinned", () => {
      expect(runAccountOrder({ ...base, pinnedId: null })).toEqual([
        "personal",
        "work",
      ]);
      expect(
        runAccountOrder({ ...base, pinnedId: null, retryOtherAccounts: false }),
      ).toEqual([null]);
    });

    it("leaves custom runners to their own credentials", () => {
      expect(
        runAccountOrder({ ...base, pinnedId: "work", defaultRunner: false }),
      ).toEqual([null]);
    });
  });

  describe("a pinned account that can't run", () => {
    it("fails when the account was removed", () => {
      expect(accountPinState("gone")).toBe("missing");
      expect(accountPinError("gone")).toMatch(/no longer signed in/);
    });

    it("fails when the account needs a re-login, naming it", () => {
      upsertClaudeAccount({ id: "work", needs_reauth: true });

      expect(accountPinState("work")).toBe("reauth");
      expect(accountPinError("work")).toMatch(
        /me@work\.example.*sign in again/,
      );
    });

    it("lets a usable pin and no pin through", () => {
      expect(accountPinError("work")).toBeNull();
      expect(accountPinState(null)).toBe("none");
      expect(accountPinError(null)).toBeNull();
    });
  });
});
