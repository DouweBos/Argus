import { describe, expect, it } from "vitest";
import { pickForkTurn } from "./fork";

const turn = (id: string, users: number, status = "completed") => ({
  id,
  status: status as "completed",
  items: [
    ...Array.from({ length: users }, () => ({ type: "userMessage" })),
    { type: "agentMessage" },
  ],
});

describe("pickForkTurn", () => {
  it("forks through the turn holding the Nth user message", () => {
    const turns = [turn("t1", 1), turn("t2", 1), turn("t3", 1)];
    expect(pickForkTurn(turns, 1)).toBe("t1");
    expect(pickForkTurn(turns, 2)).toBe("t2");
  });

  it("refuses a cut inside a steered turn, past the end, or mid-turn", () => {
    expect(pickForkTurn([turn("t1", 2)], 1)).toBeNull();
    expect(pickForkTurn([turn("t1", 1)], 2)).toBeNull();
    expect(pickForkTurn([turn("t1", 1, "inProgress")], 1)).toBeNull();
  });
});
