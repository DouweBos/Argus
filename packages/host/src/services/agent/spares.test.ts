import type { AgentSession } from "./models";
import type { NewSpare, SpareEvent } from "./spares";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSpares,
  discardSpare,
  fillSpare,
  hasSpare,
  onSpareEvent,
  takeSpare,
} from "./spares";

function fakeSpare(agentId = "warm-1"): {
  spare: NewSpare;
  kill: ReturnType<typeof vi.fn>;
  exit: (code: number) => void;
} {
  const kill = vi.fn(async () => undefined);
  let onExit: (code: number) => void = () => {};
  const agent = {
    agentId,
    sessionId: "s1",
    runner: { id: "claude-code" },
    accountId: "personal",
    handle: {
      kill,
      cleanup: vi.fn(),
      on: (event: string, cb: (code: number) => void) => {
        if (event === "exit") {
          onExit = cb;
        }
      },
    },
  } as unknown as AgentSession;

  return {
    spare: { agent, configStamp: "stamp-1" },
    kill,
    exit: (code) => onExit(code),
  };
}

const match = {
  runnerId: "claude-code",
  accountId: "personal",
  configStamp: "stamp-1",
};

describe("spare pool", () => {
  const events: SpareEvent[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    unsubscribe = onSpareEvent((e) => events.push(e));
  });

  afterEach(() => {
    unsubscribe();
    clearSpares();
    events.length = 0;
  });

  it("hands its spare to exactly one of two starts", async () => {
    const { spare } = fakeSpare();
    await fillSpare("s1", async () => spare);

    expect(takeSpare("s1", match)).toBe(spare.agent);
    expect(takeSpare("s1", match)).toBeNull();
    expect(events.at(-1)).toEqual({ type: "taken", sessionId: "s1" });
  });

  it.each([
    ["runner", { runnerId: "custom:apex" }],
    ["account", { accountId: "work" }],
    ["config", { configStamp: "stamp-2" }],
  ] as const)("drops a spare with the wrong %s", async (reason, over) => {
    const { spare, kill } = fakeSpare();
    await fillSpare("s1", async () => spare);

    expect(takeSpare("s1", { ...match, ...over })).toBeNull();
    expect(kill).toHaveBeenCalled();
    expect(hasSpare("s1")).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "discarded",
      sessionId: "s1",
      reason,
    });
  });

  it("spawns one spare per session however often it's asked", async () => {
    const spawn = vi.fn(async () => fakeSpare().spare);
    await Promise.all([fillSpare("s1", spawn), fillSpare("s1", spawn)]);
    await fillSpare("s1", spawn);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("kills a spare whose session was discarded while it spawned", async () => {
    const { spare, kill } = fakeSpare();
    let arrive: (s: NewSpare) => void = () => {};
    const filled = fillSpare(
      "s1",
      () => new Promise<NewSpare>((resolve) => (arrive = resolve)),
    );
    discardSpare("s1", "session");
    arrive(spare);
    await filled;

    expect(kill).toHaveBeenCalled();
    expect(hasSpare("s1")).toBe(false);
  });

  it("forgets a spare whose process exits on its own", async () => {
    const { spare, exit } = fakeSpare();
    await fillSpare("s1", async () => spare);
    exit(1);

    expect(hasSpare("s1")).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "discarded",
      sessionId: "s1",
      reason: "exited",
    });
  });

  it("ignores the exit of a spare that was taken", async () => {
    const { spare, exit } = fakeSpare();
    await fillSpare("s1", async () => spare);
    takeSpare("s1", match);
    exit(0);

    expect(events.at(-1)).toEqual({ type: "taken", sessionId: "s1" });
  });

  it("reports a spawn that failed", async () => {
    await fillSpare("s1", async () => {
      throw "no cli";
    });

    expect(hasSpare("s1")).toBe(false);
    expect(events).toEqual([
      { type: "failed", sessionId: "s1", error: "no cli" },
    ]);
  });
});
