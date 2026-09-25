import { afterEach, describe, expect, it } from "vitest";
import {
  beginFeedbackTurn,
  endFeedbackTurn,
  proposalClearingBlock,
  resetFeedbackTurns,
} from "./feedbackGuard";

describe("proposalClearingBlock", () => {
  afterEach(() => {
    resetFeedbackTurns();
  });

  it("lets an ordinary run clear whatever it likes", () => {
    expect(proposalClearingBlock("run-1")).toBeNull();
  });

  it("refuses a feedback turn that was not allowed to clear", () => {
    beginFeedbackTurn("run-1", false);
    expect(proposalClearingBlock("run-1")).toContain("only ever adds");
  });

  it("allows one the user opted into", () => {
    beginFeedbackTurn("run-1", true);
    expect(proposalClearingBlock("run-1")).toBeNull();
  });

  it("only holds the run being given feedback", () => {
    beginFeedbackTurn("run-1", false);
    expect(proposalClearingBlock("run-2")).toBeNull();
  });

  it("lifts once the turn is over", () => {
    beginFeedbackTurn("run-1", false);
    endFeedbackTurn("run-1");
    expect(proposalClearingBlock("run-1")).toBeNull();
  });
});
