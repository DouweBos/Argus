/** An account command's refusal reaches host.log as well as the caller. */

import { afterEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
vi.mock("@argus/host/logger", async (original) => ({
  ...(await original<object>()),
  warn,
}));
vi.mock("../services/account/service", async (original) => ({
  ...(await original<object>()),
  linkLocalBegin: () =>
    Promise.reject("This computer is already linked to an account"),
}));

const { invokeCommand, resetCommandRegistry } =
  await import("../services/command/registry");
const { registerAccountCommands } = await import("./account");

describe("account commands", () => {
  afterEach(() => {
    resetCommandRegistry();
    warn.mockClear();
  });

  it("logs a refusal with the command's name and rethrows it", async () => {
    registerAccountCommands();
    await expect(invokeCommand("account_link_local_begin", {})).rejects.toBe(
      "This computer is already linked to an account",
    );
    expect(warn).toHaveBeenCalledWith(
      "[account] account_link_local_begin failed: This computer is already linked to an account",
    );
  });
});
