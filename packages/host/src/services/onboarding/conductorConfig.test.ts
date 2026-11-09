import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PORT_SLOT_ENV,
  convertCommand,
  importConductorConfig,
  readConductorScripts,
} from "./conductorConfig";

interface Config {
  run: { command: string; cwd?: string; title: string }[];
  setup: { commands: string[] };
  workspace_env: { name: string }[];
}

describe("conductor import", () => {
  let tmpRoot: string;

  function writeFile(rel: string, content: string): void {
    const full = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-conductor-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("readConductorScripts", () => {
    it("is null without a Conductor config", () => {
      expect(readConductorScripts(tmpRoot)).toBeNull();
    });

    it("reads the legacy conductor.json", () => {
      writeFile(
        "conductor.json",
        JSON.stringify({
          scripts: { setup: "npm install", run: "npm run dev", archive: "x" },
          runScriptMode: "nonconcurrent",
        }),
      );
      expect(readConductorScripts(tmpRoot)).toEqual({
        format: "conductor_json",
        setup: "npm install",
        archive: "x",
        runMode: "nonconcurrent",
        run: [{ title: "Run", command: "npm run dev" }],
        env: {},
      });
    });

    it("prefers settings.toml, layers the local file's scripts, keeps its env out", () => {
      writeFile(
        "conductor.json",
        JSON.stringify({ scripts: { setup: "old" } }),
      );
      writeFile(
        ".conductor/settings.toml",
        `[scripts]
setup = "pnpm install"

[scripts.run.storybook]
command = "pnpm storybook"

[scripts.run.dev]
command = "pnpm"
args = ["dev", "--port", "$CONDUCTOR_PORT"]
default = true
options = { cwd = "apps/web" }

[scripts.run.deploy]
command = "pnpm deploy"
available_in = ["cloud"]

[environment_variables]
NODE_ENV = "development"
`,
      );
      writeFile(
        ".conductor/settings.local.toml",
        `[scripts]
setup = "pnpm install --offline"

[environment_variables]
SECRET = "nope"
`,
      );
      const scripts = readConductorScripts(tmpRoot);
      expect(scripts?.format).toBe("settings_toml");
      expect(scripts?.setup).toBe("pnpm install --offline");
      expect(scripts?.run).toEqual([
        {
          title: "Dev",
          command: "pnpm dev --port '$CONDUCTOR_PORT'",
          cwd: "apps/web",
        },
        { title: "Storybook", command: "pnpm storybook" },
      ]);
      expect(scripts?.env).toEqual({ NODE_ENV: "development" });
    });
  });

  describe("importConductorConfig", () => {
    it("replaces the guessed setup and run with Conductor's", () => {
      writeFile("package.json", JSON.stringify({ scripts: { dev: "vite" } }));
      writeFile("pnpm-lock.yaml", "");
      writeFile(
        "conductor.json",
        JSON.stringify({
          scripts: {
            setup: "pnpm install && cp $CONDUCTOR_ROOT_PATH/.env .env",
            run: "pnpm dev --port $CONDUCTOR_PORT",
            archive: "./archive.sh",
          },
          runScriptMode: "nonconcurrent",
        }),
      );
      const result = importConductorConfig(tmpRoot);
      const config = result?.suggestion.config as unknown as Config;
      expect(config.setup.commands).toHaveLength(1);
      expect(config.setup.commands[0]).toContain("CONDUCTOR_ROOT_PATH=");
      expect(config.run.map((r) => r.title)).toEqual(["Run"]);
      expect(config.workspace_env.map((e) => e.name)).toContain(PORT_SLOT_ENV);
      expect(result?.suggestion.signals[0].label).toBe("Conductor");
      expect(result?.notes).toHaveLength(2);
    });
  });

  describe("convertCommand", () => {
    function git(cwd: string, ...args: string[]): void {
      execFileSync("git", args, { cwd, stdio: "ignore" });
    }

    it("runs in a worktree with Conductor's variables set", () => {
      const repo = path.join(tmpRoot, "repo");
      const ws = path.join(tmpRoot, "workspaces", "lisbon");
      fs.mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      git(
        repo,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "i",
      );
      git(repo, "worktree", "add", "-q", ws);

      const script = `echo "$CONDUCTOR_WORKSPACE_NAME|$CONDUCTOR_PORT|$GREETING"
echo "$CONDUCTOR_ROOT_PATH" 'it''s'`;
      const { command, usesPort, unsupported } = convertCommand(
        script,
        { GREETING: "hi there" },
        "main",
      );
      expect(command).not.toContain("\n");
      expect(usesPort).toBe(true);
      expect(unsupported).toEqual([]);
      const out = execFileSync("sh", ["-c", command], {
        cwd: ws,
        env: { ...process.env, [PORT_SLOT_ENV]: "2" },
        encoding: "utf8",
      });
      expect(out.trim().split("\n")).toEqual([
        "lisbon|55020|hi there",
        `${fs.realpathSync(repo)} its`,
      ]);
    });

    it("reports variables Argus doesn't set", () => {
      expect(
        convertCommand("curl $CONDUCTOR_API_URL", {}, "main").unsupported,
      ).toEqual(["CONDUCTOR_API_URL"]);
    });
  });
});
