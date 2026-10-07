import { beforeEach, describe, expect, it, vi } from "vitest";

const probeAccountAuth = vi.fn();
vi.mock("../claudeAuth/probe", () => ({ probeAccountAuth }));
vi.mock("../claudeAuth/claudeAuth", () => ({ emitAccountsChanged: vi.fn() }));
vi.mock("../claudeAuth/accounts", () => ({
  getActiveAccountId: () => "a1",
  listClaudeAccounts: () => [{ id: "a1" }],
  recordAuthOutcome: () => false,
}));

const { runPrereqChecks } = await import("./prereqs");

describe("claude_auth prereq", () => {
  beforeEach(() => probeAccountAuth.mockReset());

  it("shares one probe between checks asked for at the same time", async () => {
    let finish: (outcome: string) => void = () => undefined;
    probeAccountAuth.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = runPrereqChecks(() => undefined, ["claude_auth"]);
    const second = runPrereqChecks(() => undefined, ["claude_auth"]);
    finish("ok");

    const pass = [
      { id: "claude_auth", status: "pass", message: "authenticated" },
    ];
    await expect(first).resolves.toEqual(pass);
    await expect(second).resolves.toEqual(pass);
    expect(probeAccountAuth).toHaveBeenCalledOnce();
  });

  it("probes again once the previous check has finished", async () => {
    probeAccountAuth.mockResolvedValue("ok");
    await runPrereqChecks(() => undefined, ["claude_auth"]);
    await runPrereqChecks(() => undefined, ["claude_auth"]);

    expect(probeAccountAuth).toHaveBeenCalledTimes(2);
  });
});
