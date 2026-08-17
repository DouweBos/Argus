import type { LlmRunner } from "./runners/types";
import { beforeEach, describe, expect, it } from "vitest";
import { listRunners, registerRunner } from "./registry";
import { resolveModelForAgent, resolveRunnerForSession } from "./resolve";

function fakeRunner(id: string, isCustom = false): LlmRunner {
  return {
    id,
    displayName: id,
    isCustom,
    capabilities: () => ({
      supportsMcp: true,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
    }),
    preflight: async () => ({ ok: true, binPath: "/usr/bin/fake" }),
    spawn: async () => ({}) as never,
    oneShot: async () => null,
  };
}

describe("resolveRunnerForSession", () => {
  beforeEach(() => {
    // The registry registers Claude Code at module load; add a custom one so
    // every case below runs with more than one runner registered.
    registerRunner(fakeRunner("custom:apex", true));
  });

  it("ignores custom runners when nothing chose one", () => {
    expect(listRunners().length).toBeGreaterThan(1);

    const { runner } = resolveRunnerForSession({ repoRoot: "/repo" });
    expect(runner.id).toBe("claude-code");
  });

  it("honours a custom runner pinned by the project", () => {
    const { runner, defaultModel } = resolveRunnerForSession({
      repoRoot: "/repo",
      argusConfig: {
        llm: { runner: "custom:apex", model: "callstack/Apex" },
      },
    });

    expect(runner.id).toBe("custom:apex");
    expect(defaultModel).toBe("callstack/Apex");
  });

  it("honours a custom runner set as the app default", () => {
    const { runner } = resolveRunnerForSession({
      repoRoot: "/repo",
      appDefault: { runner: "custom:apex" },
    });

    expect(runner.id).toBe("custom:apex");
  });

  it("falls back to the built-in when the pinned runner is gone", () => {
    const { runner } = resolveRunnerForSession({
      repoRoot: "/repo",
      argusConfig: { llm: { runner: "custom:deleted" } },
    });

    expect(runner.id).toBe("claude-code");
  });
});

describe("resolveModelForAgent", () => {
  it("uses the runner default only when no other level pinned a model", () => {
    expect(
      resolveModelForAgent({
        session: {},
        runnerDefaultModel: "callstack/Apex",
      }).model,
    ).toBe("callstack/Apex");

    expect(
      resolveModelForAgent({
        session: { model: "sonnet" },
        runnerDefaultModel: "callstack/Apex",
      }).model,
    ).toBe("sonnet");
  });
});
