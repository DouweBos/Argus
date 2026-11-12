import type { LlmRunner, RunnerAuthProbe } from "./runners/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runners: [] as Partial<LlmRunner>[],
  installed: new Set<string>(),
  forgotten: [] as string[],
  probes: 0,
}));

vi.mock("./registry", () => ({
  listRunners: () => state.runners,
  forgetRunnerAvailability: (id: string) => state.forgotten.push(id),
  runnerAvailability: async () =>
    new Map(
      state.runners.map((r) => [
        r.id,
        {
          available: state.installed.has(r.id!),
          unavailableReason: state.installed.has(r.id!)
            ? null
            : `${r.displayName} isn't installed.`,
        },
      ]),
    ),
}));

const captured = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("../telemetry/telemetry", () => ({
  capture: (event: string, props: unknown) => captured.push([event, props]),
}));

const { checkRunnerAccounts, listRunnerAccounts } =
  await import("./runnerAccounts");

function runner(
  id: string,
  extra: Partial<LlmRunner> = {},
): Partial<LlmRunner> {
  return {
    id,
    displayName: id,
    setup: () => ({
      installCommand: `install ${id}`,
      installUrl: null,
      loginCommand: `${id} login`,
    }),
    ...extra,
  };
}

function probe(result: RunnerAuthProbe): () => Promise<RunnerAuthProbe> {
  return async () => {
    state.probes += 1;

    return result;
  };
}

describe("listRunnerAccounts", () => {
  beforeEach(() => {
    state.installed = new Set(["codex", "cursor", "custom:goose"]);
    state.forgotten = [];
    state.probes = 0;
    captured.length = 0;
    state.runners = [
      runner("claude-code"),
      runner("gemini"),
      runner("codex", {
        authStatus: probe({ signedIn: true, account: "ChatGPT" }),
      }),
      runner("cursor", {
        authStatus: probe({ signedIn: false, account: null }),
      }),
      runner("custom:goose", { isCustom: true, baseRunnerId: "acp" }),
      runner("custom:gateway", { isCustom: true, baseRunnerId: "claude-code" }),
    ];
  });

  it("lists every runner but Claude Code and derived runners, installed first", async () => {
    const accounts = await listRunnerAccounts({}, 1_000);
    expect(accounts.map((a) => [a.id, a.status, a.account])).toEqual([
      ["codex", "signed_in", "ChatGPT"],
      ["cursor", "signed_out", null],
      ["custom:goose", "unknown", null],
      ["gemini", "not_installed", null],
    ]);
    expect(accounts.find((a) => a.id === "gemini")?.detail).toBe(
      "gemini isn't installed.",
    );
    expect(accounts.find((a) => a.id === "custom:goose")?.canProbe).toBe(false);
  });

  it("caches a probe until asked to refresh one runner", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await listRunnerAccounts();
    await listRunnerAccounts();
    expect(state.probes).toBe(2);

    await checkRunnerAccounts({ refresh: true, runnerId: "cursor" });
    expect(state.forgotten).toEqual(["cursor"]);
    expect(state.probes).toBe(3);
    expect(captured).toEqual([
      [
        "runner_account_action",
        { runner: "cursor", action: "check_again", outcome: "signed_out" },
      ],
    ]);
    vi.useRealTimers();
  });
});

describe("auth status parsers", async () => {
  const { parseCodexLoginStatus } = await import("./runners/codex/runner");
  const { parseCursorStatus } = await import("./runners/acp/presets/cursor");
  const { parseKiroWhoami } = await import("./runners/acp/presets/kiro");
  const { parseOpencodeAuthList } =
    await import("./runners/acp/presets/opencode");

  it("reads codex login status without keeping the key", () => {
    expect(parseCodexLoginStatus("Not logged in\n", 1)).toEqual({
      signedIn: false,
      account: null,
    });
    expect(parseCodexLoginStatus("Logged in using ChatGPT\n", 0)).toEqual({
      signedIn: true,
      account: "ChatGPT",
    });
    expect(
      parseCodexLoginStatus("API key configured - sk-proj***abcde\n", 0),
    ).toEqual({ signedIn: true, account: "API key" });
    expect(parseCodexLoginStatus("Error checking login status: x", 1)).toEqual({
      signedIn: null,
      account: null,
    });
  });

  it("reads cursor-agent status", () => {
    expect(parseCursorStatus("Checking…\n Not logged in")).toEqual({
      signedIn: false,
      account: null,
    });
    expect(parseCursorStatus("✓ Logged in as dev@example.com")).toEqual({
      signedIn: true,
      account: "dev@example.com",
    });
    expect(parseCursorStatus("✓ Logged in as user id 42")).toEqual({
      signedIn: true,
      account: null,
    });
    expect(
      parseCursorStatus("Partially authenticated (missing refresh token)"),
    ).toEqual({ signedIn: false, account: null });
  });

  it("reads kiro-cli whoami", () => {
    expect(parseKiroWhoami("Not logged in")).toEqual({
      signedIn: false,
      account: null,
    });
    expect(
      parseKiroWhoami("Logged in with IAM Identity Center (https://x)"),
    ).toEqual({ signedIn: true, account: "IAM Identity Center" });
  });

  it("reads opencode auth list", () => {
    expect(parseOpencodeAuthList("Credentials ~/x\n 0 credentials")).toEqual({
      signedIn: false,
      account: null,
    });
    expect(
      parseOpencodeAuthList("Anthropic oauth\nOpenAI api\n 2 credentials"),
    ).toEqual({ signedIn: true, account: "2 providers" });
    expect(
      parseOpencodeAuthList("0 credentials\nEnvironment\n ANTHROPIC_API_KEY"),
    ).toEqual({ signedIn: null, account: null });
  });
});
