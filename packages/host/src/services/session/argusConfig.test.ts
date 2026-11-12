import type { Session } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { loadHostArgusConfig } from "../userProjectSettings/store";
import {
  exportProjectConfig,
  getProjectConfig,
  importProjectConfig,
  loadArgusConfig,
  saveProjectConfig,
} from "./argusConfig";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

let home: string;
let repo: string;

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, JSON.stringify(value));
}

/** Saves `config` with every key in it marked edited. */
function store(dir: string, config: Record<string, unknown>) {
  return saveProjectConfig(dir, config, Object.keys(config));
}

describe("project config", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-home-"));
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "argus-repo-"));
    vi.stubEnv("ARGUS_HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    appState.sessions.clear();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  describe("loadArgusConfig layers", () => {
    it("reads the stored config alone when the repo has no .argus.json", () => {
      store(repo, { browser_url: "http://localhost:3000" });
      expect(fs.existsSync(path.join(repo, ".argus.json"))).toBe(false);
      expect(loadArgusConfig(repo).browser_url).toBe("http://localhost:3000");
    });

    it("layers the stored config over the repo file", () => {
      writeJson(path.join(repo, ".argus.json"), {
        browser_url: "http://repo",
        protected_branches: ["main"],
        setup: { copy: [".env"] },
      });
      store(repo, {
        browser_url: "http://mac",
        protected_branches: ["main"],
        setup: { copy: [".env", "secrets/"] },
      });

      const config = loadArgusConfig(repo);
      expect(config.browser_url).toBe("http://mac");
      expect(config.protected_branches).toEqual(["main"]);
      expect(config.setup.copy).toEqual([".env", "secrets/"]);
    });

    it("stores the edited keys and keeps the rest following the repo", () => {
      writeJson(path.join(repo, ".argus.json"), {
        browser_url: "http://repo",
        run: [{ title: "Dev", command: "pnpm dev" }],
      });
      const result = saveProjectConfig(
        repo,
        {
          browser_url: "http://repo",
          run: [{ title: "Dev", command: "pnpm dev" }],
          single_runtime: true,
        },
        ["single_runtime"],
      );

      expect(loadHostArgusConfig(repo)).toEqual({ single_runtime: true });
      expect(result.repo_keys.sort()).toEqual(["browser_url", "run"]);
      expect(result.host_keys).toEqual(["single_runtime"]);

      writeJson(path.join(repo, ".argus.json"), { browser_url: "http://b" });
      expect(loadArgusConfig(repo).browser_url).toBe("http://b");
    });

    it("keeps an edited value that matches the repo after the repo changes", () => {
      writeJson(path.join(repo, ".argus.json"), { browser_url: "http://a" });
      saveProjectConfig(repo, { browser_url: "http://a" }, ["browser_url"]);
      writeJson(path.join(repo, ".argus.json"), {});

      expect(loadArgusConfig(repo).browser_url).toBe("http://a");
    });

    it("keeps keys already stored when a later save edits others", () => {
      writeJson(path.join(repo, ".argus.json"), { browser_url: "http://a" });
      saveProjectConfig(repo, { browser_url: "http://a" }, ["browser_url"]);
      saveProjectConfig(
        repo,
        { browser_url: "http://a", single_runtime: true },
        ["single_runtime"],
      );

      expect(loadHostArgusConfig(repo)).toEqual({
        browser_url: "http://a",
        single_runtime: true,
      });
    });

    it("doesn't repeat a repo terminal the stored config also lists", () => {
      const logs = { name: "Logs", dir: "" };
      writeJson(path.join(repo, ".argus.json"), { terminals: [logs] });
      store(repo, { terminals: [logs, { name: "Db", dir: "db" }] });

      expect(loadArgusConfig(repo).terminals).toEqual([
        logs,
        { name: "Db", dir: "db" },
      ]);
    });

    it("gives a worktree its project's stored config", () => {
      const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "argus-wt-"));
      appState.sessions.set("s1", {
        path: worktree,
        repo_root: repo,
      } as Session);
      store(repo, { browser_url: "http://mac" });

      expect(loadArgusConfig(worktree).browser_url).toBe("http://mac");
      fs.rmSync(worktree, { recursive: true, force: true });
    });

    it("keeps keys Argus doesn't know through a round trip", () => {
      writeJson(path.join(repo, ".argus.json"), { $schema: "x" });
      store(repo, { custom: 1, run: [] });

      expect(getProjectConfig(repo).config).toMatchObject({
        $schema: "x",
        custom: 1,
      });
    });
  });

  describe(".argus.local.json migration", () => {
    it("imports the local file once, then ignores it", () => {
      writeJson(path.join(repo, ".argus.json"), { browser_url: "http://repo" });
      writeJson(path.join(repo, ".argus.local.json"), {
        browser_url: "http://local",
      });

      expect(loadArgusConfig(repo).browser_url).toBe("http://local");
      expect(loadHostArgusConfig(repo)).toEqual({
        browser_url: "http://local",
      });

      writeJson(path.join(repo, ".argus.local.json"), {
        browser_url: "http://changed",
      });
      expect(loadArgusConfig(repo).browser_url).toBe("http://local");
    });

    it("doesn't import over a config already stored", () => {
      store(repo, { browser_url: "http://mac" });
      writeJson(path.join(repo, ".argus.local.json"), {
        browser_url: "http://local",
      });

      expect(loadArgusConfig(repo).browser_url).toBe("http://mac");
    });

    it("skips an invalid local file without storing anything", () => {
      fs.writeFileSync(path.join(repo, ".argus.local.json"), "{ nope");

      expect(loadArgusConfig(repo).browser_url).toBeNull();
      expect(loadHostArgusConfig(repo)).toBeUndefined();
    });
  });

  describe("export / import", () => {
    it("exports the effective config as .argus.json text", () => {
      writeJson(path.join(repo, ".argus.json"), {
        protected_branches: ["main"],
      });
      store(repo, { browser_url: "http://mac" });

      const exported = JSON.parse(exportProjectConfig(repo)) as Record<
        string,
        unknown
      >;
      expect(exported).toEqual({
        protected_branches: ["main"],
        browser_url: "http://mac",
      });
    });

    it("round-trips an export through import", () => {
      store(repo, {
        setup: { copy: [{ path: "node_modules", exclude: ["*.log"] }] },
        run: [{ title: "Dev", command: "pnpm dev", restartOnRerun: true }],
        workspace_env: [
          { name: "PORT", base_value: 3000, range: 100, strategy: "hash" },
        ],
        llm: { runner: "claude-code" },
      });
      const before = loadArgusConfig(repo);
      importProjectConfig(repo, exportProjectConfig(repo));

      expect(loadArgusConfig(repo)).toEqual(before);
    });

    it("keeps imported keys that match the repo file after the repo loses them", () => {
      const file = {
        browser_url: "http://repo",
        related_projects: [{ path: "../api", description: "Backend" }],
        tools: { disabled: ["device-debug"] },
      };
      writeJson(path.join(repo, ".argus.json"), file);
      importProjectConfig(repo, JSON.stringify(file));
      writeJson(path.join(repo, ".argus.json"), {
        browser_url: "http://repo",
      });

      const config = loadArgusConfig(repo);
      expect(config.related_projects).toEqual(file.related_projects);
      expect(config.tools?.disabled).toEqual(["device-debug"]);
      expect(Object.keys(loadHostArgusConfig(repo) ?? {}).sort()).toEqual([
        "browser_url",
        "related_projects",
        "tools",
      ]);
    });

    it("replaces the stored config", () => {
      store(repo, {
        browser_url: "http://old",
        single_runtime: true,
      });
      importProjectConfig(repo, JSON.stringify({ browser_url: "http://new" }));

      expect(loadHostArgusConfig(repo)).toEqual({ browser_url: "http://new" });
    });

    it("rejects invalid JSON", () => {
      expect(() => importProjectConfig(repo, "{ nope")).toThrow(
        /Not a valid \.argus\.json/,
      );
    });

    it("rejects JSON that isn't an object", () => {
      expect(() => importProjectConfig(repo, "[1, 2]")).toThrow(
        /Not a valid \.argus\.json: expected a JSON object/,
      );
    });

    it("rejects a config the normalizer refuses, leaving the store alone", () => {
      store(repo, { browser_url: "http://keep" });

      expect(() =>
        importProjectConfig(repo, JSON.stringify({ run: [{ title: "" }] })),
      ).toThrow(/Invalid project config: run\[0\]\.title/);
      expect(loadHostArgusConfig(repo)).toEqual({ browser_url: "http://keep" });
    });
  });
});
