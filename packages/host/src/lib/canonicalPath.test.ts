import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalPath } from "./canonicalPath";

describe("canonicalPath", () => {
  let real: string;
  let link: string;

  beforeEach(() => {
    real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canon-")));
    link = `${real}-link`;
    fs.symlinkSync(real, link);
  });

  afterEach(() => {
    fs.rmSync(link, { force: true });
    fs.rmSync(real, { recursive: true, force: true });
  });

  it("resolves a symlinked directory", () => {
    expect(canonicalPath(link)).toBe(real);
  });

  it("resolves the existing prefix of a path that isn't there yet", () => {
    expect(canonicalPath(path.join(link, "worktrees", "feat"))).toBe(
      path.join(real, "worktrees", "feat"),
    );
  });

  it.runIf(process.platform === "darwin")(
    "spells /tmp the way git reports it",
    () => {
      expect(canonicalPath("/tmp/argus-none/x")).toBe(
        "/private/tmp/argus-none/x",
      );
    },
  );
});
