import { describe, expect, it } from "vitest";
import { readableStartError } from "./startError";

describe("readableStartError", () => {
  it("keeps the cause and drops git's progress output", () => {
    const raw = [
      "Preparing worktree (new branch 'douwe/scroll')",
      "Updating files:  13% (1112/8324)\rUpdating files: 100% (8324/8324), done.",
      "mise ERROR Config files in /wt/mise.toml are not trusted.",
      "Trust them with `mise trust`. See https://mise.en.dev/cli/trust.html for more information.",
      "mise ERROR Version: 2026.7.0 macos-arm64 (2026-07-02)",
      "mise ERROR Run with --verbose or MISE_VERBOSE=1 for more information",
    ].join("\n");

    expect(readableStartError(raw)).toBe(
      "mise ERROR Config files in /wt/mise.toml are not trusted. Trust them with `mise trust`. See https://mise.en.dev/cli/trust.html for more information.",
    );
  });

  it("caps a long message", () => {
    expect(readableStartError("x".repeat(1000))).toHaveLength(280);
  });

  it("reads an Error", () => {
    expect(readableStartError(new Error("disk full"))).toBe("disk full");
  });
});
