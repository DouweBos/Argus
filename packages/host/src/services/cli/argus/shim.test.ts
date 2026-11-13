import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shimSource } from "./shim";

describe("shimSource", () => {
  it("runs the script with its args, honouring an ARGUS_HOME override", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus shim '"));
    const script = path.join(dir, "it's.js");
    fs.writeFileSync(
      script,
      "console.log(JSON.stringify([process.env.ARGUS_HOME, ...process.argv.slice(2)]))",
    );
    const shim = path.join(dir, "argus");
    fs.writeFileSync(shim, shimSource(process.execPath, script, "/h $x"), {
      mode: 0o755,
    });
    const env = { ...process.env };
    delete env.ARGUS_HOME;
    expect(
      JSON.parse(execFileSync(shim, ["a b", "-"], { env }).toString()),
    ).toEqual(["/h $x", "a b", "-"]);
    expect(
      JSON.parse(
        execFileSync(shim, [], {
          env: { ...env, ARGUS_HOME: "/o" },
        }).toString(),
      ),
    ).toEqual(["/o"]);
  });
});
