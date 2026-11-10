/**
 * `code_format` on fixture projects: the worktree's own prettier, its config
 * from package.json, `.prettierignore`, syntax errors, timeouts, swift-format.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));

const { appState } = await import("../../state");
const { formatCode, runFormatter } = await import("./format");
const { directoriesUp } = await import("./formatters");

const repoPrettier = fs.realpathSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../node_modules/prettier",
  ),
);

let worktree: string;

function write(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(worktree, rel)), { recursive: true });
  fs.writeFileSync(path.join(worktree, rel), text);
}

/** A package with the repo's prettier linked into its node_modules, as pnpm would. */
function linkPrettier(dir = ""): void {
  const modules = path.join(worktree, dir, "node_modules");
  fs.mkdirSync(modules, { recursive: true });
  fs.symlinkSync(repoPrettier, path.join(modules, "prettier"));
}

describe("code_format", () => {
  beforeEach(async () => {
    worktree = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-format-")),
    );
    appState.sessions.clear();
    appState.sessions.set("s1", { path: worktree } as never);
  });

  afterEach(async () => {
    await fs.promises.rm(worktree, { recursive: true, force: true });
  });

  it("lists the file's directory and each parent up to the root", () => {
    expect(directoriesUp("/w", "/w/a/b/c.ts")).toEqual([
      "/w/a/b",
      "/w/a",
      "/w",
    ]);
    expect(directoriesUp("/w", "/w/c.ts")).toEqual(["/w"]);
  });

  it("says none when the project has no formatter", async () => {
    write("src/a.ts", "const a  =  1\n");
    await expect(
      formatCode("s1", "src/a.ts", "const a  =  1\n"),
    ).resolves.toEqual({
      formatter: "none",
      formatted: null,
    });
  });

  it("formats with the worktree's prettier and the package.json config", async () => {
    write("package.json", JSON.stringify({ prettier: { semi: false } }));
    linkPrettier();
    write("src/a.ts", "");
    const result = await formatCode("s1", "src/a.ts", "const a  =  'x';\n");
    expect(result).toEqual({
      formatter: "prettier",
      formatted: 'const a = "x"\n',
    });
  });

  it("detects without content, and reports nothing changed as null", async () => {
    write(".prettierrc", "{}");
    linkPrettier();
    await expect(formatCode("s1", "a.json")).resolves.toEqual({
      formatter: "prettier",
      formatted: null,
    });
    await expect(formatCode("s1", "a.json", '{ "a": 1 }\n')).resolves.toEqual({
      formatter: "prettier",
      formatted: null,
    });
  });

  it("finds a monorepo package's config and the root's prettier", async () => {
    write("package.json", "{}");
    linkPrettier();
    write(
      "packages/app/package.json",
      JSON.stringify({ prettier: { tabWidth: 4 } }),
    );
    const result = await formatCode(
      "s1",
      "packages/app/x.js",
      "function f() {\nreturn 1\n}\n",
    );
    expect(result.formatted).toBe("function f() {\n    return 1;\n}\n");
  });

  it("honours .prettierignore", async () => {
    write(".prettierrc", "{}");
    write(".prettierignore", "generated/\n");
    linkPrettier();
    const ugly = "const a  =  1\n";
    await expect(formatCode("s1", "generated/a.ts", ugly)).resolves.toEqual({
      formatter: "prettier",
      formatted: null,
    });
    expect((await formatCode("s1", "src/a.ts", ugly)).formatted).toBe(
      "const a = 1;\n",
    );
  });

  it("returns the syntax error and no text when prettier fails", async () => {
    write(".prettierrc", "{}");
    linkPrettier();
    const result = await formatCode("s1", "a.ts", "const = ;\n");
    expect(result.formatter).toBe("prettier");
    expect(result.formatted).toBeNull();
    expect(result.error).toMatch(/SyntaxError|Expression expected/);
  });

  it("says prettier isn't installed when only the config is there", async () => {
    write(".prettierrc", "{}");
    const result = await formatCode("s1", "a.ts", "x\n");
    expect(result.formatter).toBe("prettier");
    expect(result.error).toMatch(/isn't installed/);
  });

  it("kills a formatter that runs past the timeout", async () => {
    const output = await runFormatter(
      {
        formatter: "prettier",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 10000)"],
        cwd: worktree,
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
      "",
      200,
    );
    expect(output.timedOut).toBe(true);
  });

  it("answers at the timeout even when a child keeps the pipes open", async () => {
    // Like `npx prettier`: the wrapper dies, its child lives on holding stdout.
    const grandchild = `require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: "inherit" }); setTimeout(() => {}, 10000)`;
    const started = Date.now();
    const output = await runFormatter(
      {
        formatter: "prettier",
        command: process.execPath,
        args: ["-e", grandchild],
        cwd: worktree,
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
      "",
      200,
    );
    expect(output.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  const swiftFormat = (() => {
    try {
      return execFileSync("xcrun", ["--find", "swift-format"], {
        encoding: "utf8",
      }).trim();
    } catch {
      return null;
    }
  })();

  it.skipIf(!swiftFormat)(
    "formats Swift with swift-format via xcrun",
    async () => {
      write(
        ".swift-format",
        JSON.stringify({ version: 1, indentation: { spaces: 2 } }),
      );
      const result = await formatCode("s1", "Sources/A.swift", "let  a=1\n");
      expect(result).toEqual({
        formatter: "swift-format",
        formatted: "let a = 1\n",
      });
    },
  );
});
