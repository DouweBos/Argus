import type { LlmRunner, LlmRunnerSpawnArgs } from "./types";
import type { CustomRunner } from "../customRunners/store";
import { describe, expect, it, vi } from "vitest";
import { DerivedRunner } from "./derived";

function baseRunner(): LlmRunner & {
  spawnArgs: LlmRunnerSpawnArgs[];
} {
  const recorded: LlmRunnerSpawnArgs[] = [];

  return {
    id: "claude-code",
    displayName: "Claude Code",
    spawnArgs: recorded,
    capabilities: () => ({
      supportsMcp: true,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
    }),
    preflight: vi.fn(
      async () => ({ ok: true, binPath: "/usr/bin/claude" }) as const,
    ),
    spawn: vi.fn(async (args: LlmRunnerSpawnArgs) => {
      recorded.push(args);

      return {} as never;
    }),
    oneShot: vi.fn(async () => "ok"),
  };
}

const config: CustomRunner = {
  id: "custom:apex",
  displayName: "Apex",
  baseRunnerId: "claude-code",
  env: {
    ANTHROPIC_BASE_URL: "https://api.callstack.ai",
    ANTHROPIC_AUTH_TOKEN: "sk-test",
    CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
    INHERITED_ONE: "",
  },
  models: [{ id: "callstack/Apex", displayName: "Apex" }],
  defaultModel: "callstack/Apex",
};

function spawnArgs(env: NodeJS.ProcessEnv): LlmRunnerSpawnArgs {
  return {
    agentId: "a1",
    sessionId: "s1",
    cwd: "/tmp",
    model: null,
    permissionMode: null,
    resumeRef: null,
    systemPrompt: "",
    mcpServers: {},
    debugLogPath: "/tmp/a1.log",
    env,
  };
}

describe("derivedRunner", () => {
  it("takes its identity from the config and its capabilities from the base", () => {
    const base = baseRunner();
    const runner = new DerivedRunner(config, base);

    expect(runner.id).toBe("custom:apex");
    expect(runner.displayName).toBe("Apex");
    expect(runner.isCustom).toBe(true);
    expect(runner.baseRunnerId).toBe("claude-code");
    expect(runner.capabilities().supportsMcp).toBe(true);
  });

  it("layers env overrides on the spawn env and unsets empty values", async () => {
    const base = baseRunner();
    await new DerivedRunner(config, base).spawn(
      spawnArgs({ PATH: "/usr/bin", INHERITED_ONE: "keep-me" }),
    );

    const env = base.spawnArgs[0]?.env;
    expect(env?.PATH).toBe("/usr/bin");
    expect(env?.ANTHROPIC_BASE_URL).toBe("https://api.callstack.ai");
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBe("sk-test");
    expect(env).not.toHaveProperty("INHERITED_ONE");
  });

  it("falls back to its default model when no level pinned one", async () => {
    const base = baseRunner();
    await new DerivedRunner(config, base).spawn(spawnArgs({}));

    expect(base.spawnArgs[0]?.model).toBe("callstack/Apex");
  });

  it("keeps an explicit model override", async () => {
    const base = baseRunner();
    await new DerivedRunner(config, base).spawn({
      ...spawnArgs({}),
      model: "callstack/Other",
    });

    expect(base.spawnArgs[0]?.model).toBe("callstack/Other");
  });

  it("exposes the configured models to the picker", () => {
    const runner = new DerivedRunner(config, baseRunner());

    expect(runner.models()).toEqual([
      { value: "callstack/Apex", displayName: "Apex" },
    ]);
  });

  it("routes one-shots through the gateway too", async () => {
    const base = baseRunner();
    await new DerivedRunner(config, base).oneShot({
      prompt: "title this",
      source: "test",
    });

    const call = vi.mocked(base.oneShot).mock.calls[0]?.[0];
    expect(call?.model).toBe("callstack/Apex");
    expect(call?.env?.ANTHROPIC_BASE_URL).toBe("https://api.callstack.ai");
  });
});
