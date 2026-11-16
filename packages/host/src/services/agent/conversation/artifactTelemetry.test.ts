import { describe, expect, it, vi } from "vitest";
import { artifactAction, observeArtifactCalls } from "./artifactTelemetry";

const captured: unknown[][] = [];

vi.mock("../../telemetry/telemetry", () => ({
  capture: (...args: unknown[]) => captured.push(args),
}));

describe("artifact telemetry", () => {
  it("buckets the action, publish when omitted", () => {
    expect(artifactAction({})).toBe("publish");
    expect(artifactAction({ action: "open" })).toBe("open");
    expect(artifactAction({ action: "comments" })).toBe("other");
  });

  it("counts a call once its result lands", () => {
    observeArtifactCalls({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Artifact",
            input: { action: "open" },
          },
          { type: "tool_use", id: "t2", name: "Read", input: {} },
        ],
        model: "m",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    expect(captured).toEqual([]);
    observeArtifactCalls({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t2", content: "" },
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "",
            is_error: true,
          },
        ],
      },
    });
    expect(captured).toEqual([
      ["artifact_tool_used", { action: "open", success: false }],
    ]);
  });
});
