import { describe, expect, it } from "vitest";
import type { RemoteRunner } from "../lib/protocol";
import { runnerSupport } from "./runnerSupport";

const runner = (id: string, flags: Partial<RemoteRunner> = {}): RemoteRunner => ({
  id,
  display_name: id,
  is_custom: false,
  default_model: null,
  models: [],
  ...flags,
});

const runners = [
  runner("claude-code", {
    supports_transcript_fork: true,
    supports_side_question: true,
  }),
  runner("codex", {
    supports_transcript_fork: false,
    supports_side_question: false,
  }),
  runner("old"),
];

describe("runnerSupport", () => {
  it("defaults an agent without a runner id to claude-code", () => {
    expect(runnerSupport(runners, undefined)).toEqual({
      transcriptFork: true,
      sideQuestion: true,
    });
  });

  it("hides what the runner says it can't do", () => {
    expect(runnerSupport(runners, "codex")).toEqual({
      transcriptFork: false,
      sideQuestion: false,
    });
  });

  it("treats a silent or unknown runner as able", () => {
    expect(runnerSupport(runners, "old")).toEqual({
      transcriptFork: true,
      sideQuestion: true,
    });
    expect(runnerSupport([], "codex")).toEqual({
      transcriptFork: true,
      sideQuestion: true,
    });
  });
});
