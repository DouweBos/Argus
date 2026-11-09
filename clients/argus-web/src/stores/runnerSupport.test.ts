import { describe, expect, it } from "vitest";
import type { RemoteRunner } from "../lib/protocol";
import { runnerOption, runnerSupport } from "./runnerSupport";

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

describe("runnerOption", () => {
  const base = {
    is_custom: false,
    default_model: null,
    models: [],
  };

  it("disables a runner whose cli is missing and says how to install it", () => {
    expect(
      runnerOption({
        ...base,
        id: "gemini",
        display_name: "Gemini CLI",
        available: false,
        unavailable_reason: "Install gemini",
      }),
    ).toEqual({
      value: "gemini",
      name: "Gemini CLI",
      description: "Install gemini",
      disabled: true,
    });
  });

  it("keeps runners from older hosts pickable", () => {
    expect(runnerOption({ ...base, id: "codex", display_name: "Codex" })).toEqual(
      { value: "codex", name: "Codex" },
    );
  });
});
