import type { Session } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  outputTail,
  runTeardown,
  runTeardownCommand,
  teardownDurationBucket,
} from "./teardown";

vi.mock("../terminal/loginEnv", () => ({
  loginShellEnv: () => Promise.resolve(null),
}));
vi.mock("../terminal/multiplexer", () => ({
  defaultShell: () => "/bin/sh",
  terminalEnv: () => ({ PATH: process.env.PATH ?? "", ARGUS_SLOT: "7" }),
}));

let dir: string;
const session = () => ({ id: "s1", path: dir }) as Session;

describe("teardown", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-teardown-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs each command in the worktree with the workspace env", async () => {
    const steps: string[] = [];
    await runTeardown(
      session(),
      ['echo "$ARGUS_SLOT" > slot', "echo done"],
      (s) => steps.push(`${s.current}/${s.total} ${s.detail ?? s.command}`),
    );
    expect(fs.readFileSync(path.join(dir, "slot"), "utf8").trim()).toBe("7");
    expect(steps).toContain("2/2 done");
  });

  it("stops at the first failure with the tail of its output", async () => {
    const run = runTeardown(
      session(),
      ["echo stopping; echo boom >&2; exit 3", "touch never"],
      () => {},
    );
    await expect(run).rejects.toBe(
      "Teardown command failed (exit 3): echo stopping; echo boom >&2; exit 3\nstopping\nboom",
    );
    expect(fs.existsSync(path.join(dir, "never"))).toBe(false);
  });

  it("kills a command that goes silent", async () => {
    const { code, output } = await runTeardownCommand(
      "sleep 5",
      dir,
      process.env,
      () => {},
      200,
    );
    expect(code).not.toBe(0);
    expect(output).toContain("stopped");
  });

  it("keeps the last lines of output", () => {
    expect(outputTail("a\n\nb\r\nc\n", 2)).toBe("b\nc");
  });

  it("buckets durations", () => {
    expect(teardownDurationBucket(500)).toBe("<10s");
    expect(teardownDurationBucket(30_000)).toBe("<1m");
    expect(teardownDurationBucket(120_000)).toBe("<10m");
    expect(teardownDurationBucket(700_000)).toBe(">=10m");
  });
});
