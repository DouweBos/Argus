import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("checkoutRoot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("finds the agent prompts when the host runs from another directory", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(os.tmpdir());
    const { checkoutRoot } = await import("./checkoutRoot");

    const prompt = path.join(
      checkoutRoot(),
      "packages",
      "host",
      "prompts",
      "worktree-agent-system-prompt.md",
    );
    expect(fs.existsSync(prompt)).toBe(true);
  });
});
