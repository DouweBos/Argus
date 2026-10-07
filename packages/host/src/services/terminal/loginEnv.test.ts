import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportScript,
  loginShellEnv,
  parseLoginEnv,
  writeExportScript,
} from "./loginEnv";

describe("loginShellEnv", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-login-env-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** The env a test shell starts from: nothing of the machine's own rc. */
  function baseEnv(extra: Record<string, string> = {}) {
    return { HOME: home, PATH: "/usr/bin:/bin", ...extra };
  }

  it.skipIf(!fs.existsSync("/bin/bash"))(
    "returns what the rc files export, without letting them read a terminal",
    async () => {
      // An rc that waits on a key from the terminal, as update prompts do.
      fs.writeFileSync(
        path.join(home, ".bash_profile"),
        'echo "rc noise"\nread -r -n 1 answer </dev/tty\nexport FROM_RC="a b"\n',
      );

      const env = await loginShellEnv("/bin/bash", baseEnv(), home, 5000);

      expect(env?.FROM_RC).toBe("a b");
      expect(env?.HOME).toBe(home);
    },
  );

  it.skipIf(!fs.existsSync("/bin/zsh"))(
    "keeps zsh's read -k, which reads the terminal rather than stdin, off it",
    async () => {
      fs.writeFileSync(
        path.join(home, ".zshrc"),
        "read -r -k 1 option\nexport FROM_RC=zsh\n",
      );

      const env = await loginShellEnv(
        "/bin/zsh",
        baseEnv({ ZDOTDIR: home }),
        home,
        5000,
      );

      expect(env?.FROM_RC).toBe("zsh");
    },
  );

  it("gives up on a shell it can't start as a login shell", async () => {
    await expect(
      loginShellEnv("/usr/bin/nu", baseEnv(), home),
    ).resolves.toBeNull();
  });
});

describe("parseLoginEnv", () => {
  it("ignores whatever the rc files printed before the env", () => {
    expect(
      parseLoginEnv("welcome!\n__ARGUS_LOGIN_ENV__\nA=1\0B=x=y\0"),
    ).toEqual({ A: "1", B: "x=y" });
    expect(parseLoginEnv("A=1\0")).toBeNull();
  });
});

describe("exportScript", () => {
  it("round-trips values through a shell and skips the shell's own state", () => {
    const env = {
      QUOTED: 'it\'s "$HOME" `x`\nline',
      PWD: "/elsewhere",
      "BASH_FUNC_f%%": "() { :; }",
    };
    expect(exportScript(env)).not.toMatch(/PWD|BASH_FUNC/);

    const file = writeExportScript(env);
    try {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      const out = execFileSync("/bin/sh", [
        "-c",
        `. '${file}'; printf %s "$QUOTED"`,
      ]).toString();
      expect(out).toBe(env.QUOTED);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});
