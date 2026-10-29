import type { AgentSession } from "./models";
import type { NewSpare } from "./spares";
import type { Session } from "../session/models";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { clearSpares, fillSpare } from "./spares";
import {
  getStartOptions,
  rememberStartOptions,
  resetStartOptions,
} from "./startOptions";

const caps = (name: string) => ({
  commands: [{ name, description: "", argumentHint: "" }],
  models: [{ value: `${name}-model`, displayName: name, description: "" }],
});

function spare(runnerId: string, name: string): NewSpare {
  return {
    configStamp: "x",
    agent: {
      agentId: "warm",
      sessionId: "s1",
      runner: { id: runnerId },
      handle: {
        on: () => {},
        kill: async () => {},
        cleanup: () => {},
        initializeResponse: () => caps(name),
      },
    } as unknown as AgentSession,
  };
}

describe("getStartOptions", () => {
  beforeEach(() => {
    appState.sessions.set("s1", {
      id: "s1",
      runner_id: "claude-code",
    } as unknown as Session);
  });

  afterEach(() => {
    clearSpares();
    resetStartOptions();
    appState.sessions.clear();
  });

  it("answers from the session's warm spare", async () => {
    rememberStartOptions("claude-code", caps("old"));
    await fillSpare("s1", async () => spare("claude-code", "warm"));

    const options = await getStartOptions("s1");

    expect(options.slashCommands.map((c) => c.name)).toEqual(["warm"]);
    expect(options.models.map((m) => m.value)).toEqual(["warm-model"]);
  });

  it("falls back to what that runner last reported", async () => {
    rememberStartOptions("claude-code", caps("claude"));
    rememberStartOptions("custom:apex", caps("apex"));
    await fillSpare("s1", async () => spare("claude-code", "warm"));

    const options = await getStartOptions("s1", "custom:apex");

    expect(options.slashCommands.map((c) => c.name)).toEqual(["apex"]);
  });

  it("waits for a spare on its way when nothing is known yet", async () => {
    let arrive: (s: NewSpare) => void = () => {};
    const filled = fillSpare(
      "s1",
      () => new Promise<NewSpare>((resolve) => (arrive = resolve)),
    );
    const pending = getStartOptions("s1");
    arrive(spare("claude-code", "warm"));
    await filled;

    expect((await pending).slashCommands.map((c) => c.name)).toEqual(["warm"]);
  });

  it("is empty for a runner nobody has run yet", async () => {
    await expect(getStartOptions("s1")).resolves.toEqual({
      slashCommands: [],
      models: [],
    });
  });
});
