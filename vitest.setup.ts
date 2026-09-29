import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Tests must never write into the developer's real `~/.argus`.
const argusHome = fs.mkdtempSync(path.join(os.tmpdir(), "argus-test-home-"));
process.env.ARGUS_HOME = argusHome;

afterAll(() => {
  fs.rmSync(argusHome, { recursive: true, force: true });
});
