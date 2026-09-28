import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClaudeAccount, upsertClaudeAccount } from "./accounts";
import { recheckFlaggedAccounts, resetRecheckThrottle } from "./probe";

const ping = vi.hoisted(() => vi.fn<() => Promise<{ stdout: string }>>());

vi.mock("node:child_process", () => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[
    Symbol.for("nodejs.util.promisify.custom")
  ] = ping;

  return { execFile, default: { execFile } };
});

vi.mock("./claudeAuth", () => ({ emitAccountsChanged: vi.fn() }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const OK = '{"type":"result","is_error":false,"result":"pong"}';
const LIMITED =
  '{"type":"result","is_error":true,"result":"You\'ve hit your weekly limit"}';

let home: string;
let originalHome: string | undefined;

describe("recheckFlaggedAccounts", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-probe-"));
    originalHome = process.env.ARGUS_HOME;
    process.env.ARGUS_HOME = home;
    resetRecheckThrottle();
    ping.mockReset();
  });

  afterEach(() => {
    if (originalHome === undefined) {
      Reflect.deleteProperty(process.env, "ARGUS_HOME");
    } else {
      process.env.ARGUS_HOME = originalHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("clears a limit badge once the quota has reset", async () => {
    upsertClaudeAccount({ id: "max", rate_limited: true });
    ping.mockResolvedValue({ stdout: OK });

    recheckFlaggedAccounts();

    await vi.waitFor(() => {
      expect(getClaudeAccount("max")?.rate_limited).toBe(false);
    });
  });

  it("keeps the badge while the quota is still spent", async () => {
    upsertClaudeAccount({ id: "max", rate_limited: true });
    ping.mockResolvedValue({ stdout: LIMITED });

    recheckFlaggedAccounts();

    await vi.waitFor(() => expect(ping).toHaveBeenCalled());
    expect(getClaudeAccount("max")?.rate_limited).toBe(true);
  });

  it("leaves unflagged accounts alone", () => {
    upsertClaudeAccount({ id: "fine" });

    recheckFlaggedAccounts();

    expect(ping).not.toHaveBeenCalled();
  });

  it("probes a flagged account at most once per interval", () => {
    upsertClaudeAccount({ id: "max", rate_limited: true });
    ping.mockResolvedValue({ stdout: LIMITED });

    recheckFlaggedAccounts(1_000_000);
    recheckFlaggedAccounts(1_000_000 + 60_000);
    expect(ping).toHaveBeenCalledTimes(1);

    recheckFlaggedAccounts(1_000_000 + 5 * 60_000);
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
