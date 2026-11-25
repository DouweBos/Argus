import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("checkoutRoot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("finds the checkout when the host runs from another directory", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(os.tmpdir());
    const { checkoutRoot } = await import("./checkoutRoot");

    expect(
      fs.existsSync(path.join(checkoutRoot(), "pnpm-workspace.yaml")),
    ).toBe(true);
  });
});
