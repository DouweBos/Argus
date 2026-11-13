import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "./args";

describe("parseArgs", () => {
  it("parses session new with a worktree base and wait", () => {
    expect(
      parseArgs([
        "session",
        "new",
        ".",
        "fix the build",
        "--worktree",
        "main",
        "--wait",
        "--timeout=600",
      ]),
    ).toEqual({
      kind: "new",
      dir: ".",
      prompt: "fix the build",
      worktree: "main",
      name: null,
      model: null,
      mode: null,
      json: false,
      wait: true,
      timeout: 600,
    });
  });

  it("takes - as a positional for stdin", () => {
    expect(parseArgs(["send", "a1", "-", "--wait"])).toMatchObject({
      kind: "send",
      agentId: "a1",
      message: "-",
      wait: true,
    });
  });

  it("always waits for `wait`", () => {
    expect(parseArgs(["wait", "a1"])).toMatchObject({ wait: true });
  });

  it("defaults list to the current directory", () => {
    expect(parseArgs(["list"])).toEqual({
      kind: "list",
      dir: ".",
      json: false,
    });
  });

  it.each([
    [["session", "new", "."]],
    [["send", "a1"]],
    [["show", "a1", "--wait"]],
    [["session", "new", ".", "x", "--mode", "yolo"]],
    [["wait", "a1", "--timeout", "-1"]],
    [["frobnicate"]],
    [["list", "--worktree"]],
  ])("rejects %j", (argv) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
  });

  it("shows help for no arguments or --help", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["send", "--help"])).toEqual({ kind: "help" });
  });
});
