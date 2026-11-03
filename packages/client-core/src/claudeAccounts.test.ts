import { describe, expect, it } from "vitest";
import {
  accountPickerLabel,
  accountPickerOptions,
  automationAccountOptions,
  claudeAccountRows,
  claudeSignInOutcome,
  claudeSignInPhase,
  FOLLOW_DEFAULT_ACCOUNT,
  runningAsLabel,
  type ClaudeAccountLike,
} from "./claudeAccounts";

const work: ClaudeAccountLike = {
  id: "w",
  label: "Work",
  email: "me@work.dev",
  org_name: "Acme",
  subscription_type: "max",
  needs_reauth: false,
  rate_limited: true,
  account_type: "claudeai",
};
const home: ClaudeAccountLike = {
  id: "h",
  label: null,
  email: "me@home.dev",
  org_name: null,
  subscription_type: "enterprise_plus",
  needs_reauth: true,
  account_type: "console",
};

describe("claudeAccountRows", () => {
  it("names, details and badges each account", () => {
    expect(claudeAccountRows([work, home], "w")).toEqual([
      {
        id: "w",
        label: "Work",
        detail: "me@work.dev · Acme",
        plan: "Max",
        active: true,
        needsReauth: false,
        rateLimited: true,
        console: false,
      },
      {
        id: "h",
        label: "me@home.dev",
        detail: undefined,
        plan: "enterprise_plus",
        active: false,
        needsReauth: true,
        rateLimited: false,
        console: true,
      },
    ]);
  });

  it("calls an account with no name yet signing in", () => {
    const [row] = claudeAccountRows(
      [{ id: "x", account_type: "claudeai" }],
      null,
    );
    expect(row.label).toBe("Signing in…");
  });
});

describe("account picker", () => {
  it("leads with the default, naming what it follows", () => {
    const options = accountPickerOptions([work, home], "h");
    expect(options[0]).toEqual({
      value: FOLLOW_DEFAULT_ACCOUNT,
      name: "Default account",
      description: "Follows the computer: me@home.dev",
    });
    expect(options.map((o) => o.value)).toEqual(["", "w", "h"]);
  });

  it("reads the pin, or the default", () => {
    expect(accountPickerLabel([work, home], "w")).toBe("Work");
    expect(accountPickerLabel([work, home], null)).toBe("Default account");
    expect(accountPickerLabel([work, home], "gone")).toBe("Default account");
  });

  it("keeps an automation's pin to a signed-out account listed", () => {
    expect(
      automationAccountOptions([work, home], "h", "gone").map((o) => o.value),
    ).toEqual(["", "w", "h", "gone"]);
    expect(automationAccountOptions([work, home], "h", "w")).toHaveLength(3);
  });

  it("says who an agent runs as only when there is a choice", () => {
    expect(runningAsLabel([work, home], "w")).toBe("Running as Work");
    expect(runningAsLabel([work], "w")).toBeNull();
    expect(runningAsLabel([work, home], null)).toBeNull();
  });
});

describe("claudeSignInPhase", () => {
  const idle = { starting: false, submitting: false };

  it("follows what the computer reports", () => {
    expect(claudeSignInPhase(null, idle)).toBe("idle");
    expect(claudeSignInPhase({ pending: true, needs_code: false }, idle)).toBe(
      "awaiting-browser",
    );
    expect(claudeSignInPhase({ pending: true, needs_code: true }, idle)).toBe(
      "awaiting-code",
    );
    expect(
      claudeSignInPhase({ pending: false, needs_code: false, ok: true }, idle),
    ).toBe("idle");
  });

  it("puts the local steps first", () => {
    expect(claudeSignInPhase(null, { starting: true, submitting: false })).toBe(
      "starting",
    );
    expect(
      claudeSignInPhase(
        { pending: true, needs_code: true },
        { starting: false, submitting: true },
      ),
    ).toBe("submitting");
  });

  it("reports how an attempt ended", () => {
    expect(
      claudeSignInOutcome({ pending: true, needs_code: false }),
    ).toBeNull();
    expect(
      claudeSignInOutcome({ pending: false, needs_code: false, ok: true }),
    ).toEqual({ ok: true });
    expect(
      claudeSignInOutcome({
        pending: false,
        needs_code: false,
        ok: false,
        error: "Wrong code",
      }),
    ).toEqual({ ok: false, error: "Wrong code" });
  });
});
