import { describe, expect, it } from "vitest";
import { deriveActivity, toolActivity, toolVerb } from "./activityDescription";

describe("toolVerb", () => {
  it("returns known verbs for built-in tools", () => {
    expect(toolVerb("Edit")).toBe("Editing file");
    expect(toolVerb("Bash")).toBe("Running command");
    expect(toolVerb("WebSearch")).toBe("Searching web");
  });

  it("falls back to 'Using <tool>' for unknowns", () => {
    expect(toolVerb("SomeTool")).toBe("Using SomeTool");
  });
});

describe("toolActivity", () => {
  it("returns the generic verb when no input is provided", () => {
    expect(toolActivity("Edit")).toBe("Editing file");
  });

  it("uses basename of file_path for Edit/Read/Write", () => {
    expect(toolActivity("Edit", { file_path: "/a/b/main.ts" })).toBe(
      "Editing main.ts",
    );
    expect(toolActivity("Read", { file_path: "/a/b/utils.ts" })).toBe(
      "Reading utils.ts",
    );
    expect(toolActivity("Write", { file_path: "/a/b/out.log" })).toBe(
      "Writing out.log",
    );
  });

  it("accepts either file_path or path field", () => {
    expect(toolActivity("Read", { path: "/x/y.ts" })).toBe("Reading y.ts");
  });

  it("extracts hostname for WebFetch", () => {
    expect(toolActivity("WebFetch", { url: "https://example.com/a" })).toBe(
      "Fetching example.com",
    );
  });

  it("falls back when WebFetch url is malformed", () => {
    expect(toolActivity("WebFetch", { url: "not a url" })).toBe("Fetching URL");
  });

  it("includes pattern for Glob and Grep (truncating long Grep patterns)", () => {
    expect(toolActivity("Glob", { pattern: "**/*.ts" })).toBe(
      "Finding **/*.ts",
    );
    expect(toolActivity("Grep", { pattern: "short" })).toBe(
      'Searching for "short"',
    );
    const long = "a".repeat(40);
    expect(toolActivity("Grep", { pattern: long })).toBe(
      `Searching for "${"a".repeat(20)}..."`,
    );
  });

  it("falls back to the generic verb for unknown tools", () => {
    expect(toolActivity("Custom", { foo: "bar" })).toBe("Using Custom");
  });
});

describe("deriveActivity", () => {
  it("returns stopped when agentStatus is stopped/error/null", () => {
    expect(deriveActivity(null, undefined, null, null, false)).toEqual({
      description: "Stopped",
      state: "stopped",
    });
    expect(deriveActivity("stopped", undefined, null, null, false).state).toBe(
      "stopped",
    );
    expect(deriveActivity("error", undefined, null, null, false).state).toBe(
      "stopped",
    );
  });

  it("returns idle when agent is idle", () => {
    expect(deriveActivity("idle", undefined, null, null, false)).toEqual({
      description: "Idle",
      state: "idle",
    });
  });

  it("prioritizes pending permission over tool activity", () => {
    const a = deriveActivity("running", "tool_use", "Edit", null, true);
    expect(a.state).toBe("blocked");
    expect(a.description).toBe("Waiting for permission");
  });

  it("describes the pending tool when running", () => {
    const a = deriveActivity(
      "running",
      "tool_use",
      "Edit",
      { file_path: "/a/b.ts" },
      false,
    );
    expect(a).toEqual({ description: "Editing b.ts", state: "working" });
  });

  it("returns 'Processing prompt' after user_sent", () => {
    expect(
      deriveActivity("running", "user_sent", null, null, false).description,
    ).toBe("Processing prompt");
  });

  it("returns 'Retrying API call' for api_retry system events", () => {
    expect(
      deriveActivity("running", "system:api_retry_1", null, null, false)
        .description,
    ).toBe("Retrying API call");
  });

  it("falls back to 'Thinking' when no tool or known event", () => {
    expect(
      deriveActivity("running", undefined, null, null, false).description,
    ).toBe("Thinking");
  });
});
