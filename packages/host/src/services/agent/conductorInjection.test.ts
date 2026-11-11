import { describe, expect, it, vi } from "vitest";
import {
  denyConductor,
  injectDeviceFlag,
  isConductorInvocation,
} from "./conductorInjection";

const UDID = "1ACFD403-01F8-4258-A3CB-6FCFDE0C3108";

describe("isConductorInvocation", () => {
  it("matches a bare conductor invocation", () => {
    expect(isConductorInvocation("conductor inspect")).toBe(true);
  });

  it("matches conductor after a runner", () => {
    expect(isConductorInvocation("npx conductor logs")).toBe(true);
    expect(isConductorInvocation("pnpm conductor inspect")).toBe(true);
  });

  it("matches conductor after a shell separator", () => {
    expect(isConductorInvocation("cd app && conductor inspect")).toBe(true);
    expect(isConductorInvocation("foo; conductor logs")).toBe(true);
    expect(isConductorInvocation("echo hi | conductor stdin")).toBe(true);
  });

  it("does not match the literal text in a path", () => {
    expect(
      isConductorInvocation(
        "git -C /Users/me/Work/Projects/conductor log --oneline -10",
      ),
    ).toBe(false);
    expect(isConductorInvocation("ls /Users/me/Projects/conductor/src")).toBe(
      false,
    );
  });

  it("does not match conductor as a substring of another word", () => {
    expect(isConductorInvocation("superconductor --help")).toBe(false);
  });
});

describe("injectDeviceFlag", () => {
  it("inserts --device after the first conductor arg", () => {
    expect(injectDeviceFlag("conductor inspect", UDID)).toBe(
      `conductor inspect --device ${UDID}`,
    );
  });

  it("preserves the runner prefix", () => {
    expect(injectDeviceFlag("npx conductor logs", UDID)).toBe(
      `npx conductor logs --device ${UDID}`,
    );
  });

  it("preserves the shell separator prefix", () => {
    expect(injectDeviceFlag("cd app && conductor logs", UDID)).toBe(
      `cd app && conductor logs --device ${UDID}`,
    );
  });

  it("is a no-op when --device is already present", () => {
    const cmd = "conductor logs --device web";
    expect(injectDeviceFlag(cmd, UDID)).toBe(cmd);
  });

  it("is a no-op when conductor only appears in a path", () => {
    const cmd = "git -C /Users/me/Work/Projects/conductor log --oneline -10";
    expect(injectDeviceFlag(cmd, UDID)).toBe(cmd);
  });
});

describe("denyConductor", () => {
  it("answers the request with a deny that says why", () => {
    const approveRaw = vi.fn();
    expect(
      denyConductor({
        toolName: "Bash",
        toolUseId: "t1",
        input: { command: "npx conductor inspect" },
        rawRequest: { request_id: "r1" },
        approveRaw,
      }),
    ).toEqual({ kind: "handled" });
    const sent = JSON.parse(approveRaw.mock.calls[0][0] as string);
    expect(sent.response.request_id).toBe("r1");
    expect(sent.response.response.behavior).toBe("deny");
    expect(sent.response.response.message).toMatch(/device control is off/i);
  });
});
