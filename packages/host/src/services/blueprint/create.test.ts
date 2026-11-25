import type * as GhModule from "./gh";
import type { Blueprint, BlueprintRun } from "@argus/remote-protocol";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ghCalls: string[][] = [];
let ghImpl: (args: string[], cwd: string) => Promise<string>;

vi.mock("./gh", async (importOriginal) => {
  const real = await importOriginal<typeof GhModule>();

  return {
    ...real,
    runGh: vi.fn((args: string[], cwd: string) => {
      ghCalls.push(args);

      return ghImpl(args, cwd);
    }),
  };
});
// Clones go through the shared clone service; route its `gh` calls here too.
vi.mock("../clone/run", () => ({
  runClone: vi.fn(async (opts: { args: string[]; cwd: string }) => {
    ghCalls.push(opts.args);
    await ghImpl(opts.args, opts.cwd);
  }),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("../session/manager", () => ({
  addRepoRoot: vi.fn(),
  createHeadSession: vi.fn((repoRoot: string) => ({
    id: "s1",
    repo_root: repoRoot,
  })),
}));
vi.mock("../onboarding/state", () => ({ registerProject: vi.fn() }));
vi.mock("../onboarding/argusJson", () => ({
  suggestArgusJson: vi.fn(() => ({ config: {} })),
  writeArgusJson: vi.fn(),
}));
vi.mock("../session/argusConfig", () => ({
  getProjectConfig: vi.fn(() => ({
    config: { run: [{ title: "Dev" }], related_projects: [{ path: "x" }] },
  })),
  saveProjectConfig: vi.fn(),
}));
vi.mock("../session/sessionOps", () => ({ addRelatedProject: vi.fn() }));
vi.mock("../session/waitForReady", () => ({
  waitForSessionReady: vi.fn(async () => {}),
}));
vi.mock("../agent/agentService", () => ({
  startAgent: vi.fn(async () => ({
    agent_id: "ag1",
    session_id: "s1",
    status: "idle",
    parent_agent_id: null,
    created_at: 1,
    model: null,
  })),
  sendAgentMessage: vi.fn(),
}));

const { capture } = await import("../telemetry/telemetry");
const { saveProjectConfig } = await import("../session/argusConfig");
const { addRelatedProject } = await import("../session/sessionOps");
const { sendAgentMessage, startAgent } = await import("../agent/agentService");
const manager = await import("./manager");
const create = await import("./create");

let home: string;
let apps: string;
let ref: string;
let previousHome: string | undefined;

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  const {
    id: _id,
    created_at: _c,
    updated_at: _u,
    ...rest
  } = {
    id: "",
    name: "Mac app",
    summary: "",
    parent_dir: apps,
    references: [{ path: ref, note: "release workflow" }],
    scaffold: { kind: "empty" as const },
    github: { enabled: false, owner: "", visibility: "private" as const },
    copy_project_settings_from: ref,
    instructions: "Build {{name}}",
    agent: { runner: "codex", model: "gpt", permission_mode: "auto" as const },
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };

  return manager.createBlueprint(rest);
}

async function finish(run: BlueprintRun): Promise<BlueprintRun> {
  await vi.waitFor(
    () => {
      expect(manager.getBlueprintRun(run.id)?.status).not.toBe("running");
    },
    { timeout: 10_000 },
  );

  return manager.getBlueprintRun(run.id) as BlueprintRun;
}

function stepStatuses(run: BlueprintRun): Record<string, string> {
  return Object.fromEntries(run.steps.map((s) => [s.key, s.status]));
}

describe("createProjectFromBlueprint", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-bp-home-"));
    apps = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-bp-apps-")),
    );
    ref = path.join(apps, "reference");
    fs.mkdirSync(path.join(ref, ".git"), { recursive: true });
    process.env.ARGUS_HOME = home;
    for (const [key, value] of Object.entries({
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    })) {
      vi.stubEnv(key, value);
    }
    manager.resetBlueprintCache();
    ghCalls.length = 0;
    ghImpl = async () => "";
    create.cloneRetry.delayMs = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.ARGUS_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(apps, { recursive: true, force: true });
  });

  describe("createProjectFromBlueprint, local only", () => {
    it("inits a real repo, registers it and starts the agent", async () => {
      const blueprint = makeBlueprint();
      const started = await create.createProjectFromBlueprint({
        blueprintId: blueprint.id,
        name: "tally",
        description: "A counter",
      });
      expect(started.status).toBe("running");

      const run = await finish(started);
      expect(run.status).toBe("done");
      expect(stepStatuses(run)).toEqual({
        validate: "done",
        create_repo: "done",
        register: "done",
        start_agent: "done",
      });
      const repo = path.join(apps, "tally");
      expect(fs.readFileSync(path.join(repo, "README.md"), "utf8")).toBe(
        "# tally\n\nA counter\n",
      );
      expect(
        execFileSync("git", ["log", "--format=%s"], { cwd: repo }).toString(),
      ).toBe("Initial commit\n");
      expect(ghCalls).toEqual([]);

      // Settings copied without the source's own related projects.
      expect(saveProjectConfig).toHaveBeenCalledWith(
        repo,
        { run: [{ title: "Dev" }] },
        ["run"],
      );
      expect(addRelatedProject).toHaveBeenCalledWith(repo, {
        path: "../reference",
        description: "release workflow",
      });
      expect(startAgent).toHaveBeenCalledWith(
        "s1",
        "gpt",
        "auto",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "codex",
      );
      expect(vi.mocked(sendAgentMessage).mock.calls[0][1]).toContain(
        "Build tally",
      );
      expect(run.session_id).toBe("s1");
      expect(run.agent_id).toBe("ag1");
      expect(capture).toHaveBeenCalledWith(
        "blueprint_project_created",
        expect.objectContaining({ success: true, scaffold: "empty" }),
      );
    });

    it("fails validation when the folder exists, and touches nothing", async () => {
      fs.mkdirSync(path.join(apps, "taken"));
      const blueprint = makeBlueprint();
      const run = await finish(
        await create.createProjectFromBlueprint({
          blueprintId: blueprint.id,
          name: "taken",
          description: "",
        }),
      );
      expect(run.status).toBe("failed");
      expect(stepStatuses(run)).toMatchObject({
        validate: "failed",
        create_repo: "pending",
      });
      expect(run.steps[0].error).toContain("already exists");
    });

    it("rejects a name that is not a slug", async () => {
      const blueprint = makeBlueprint();
      const run = await finish(
        await create.createProjectFromBlueprint({
          blueprintId: blueprint.id,
          name: "my app",
          description: "",
        }),
      );
      expect(run.steps[0].status).toBe("failed");
    });
  });

  describe("createProjectFromBlueprint, from a GitHub template", () => {
    const templated = () =>
      makeBlueprint({
        scaffold: { kind: "github_template", repo: "me/template" },
        github: { enabled: true, owner: "", visibility: "public" },
      });

    it("creates, retries the clone until GitHub has generated it, then registers", async () => {
      let cloneAttempts = 0;
      ghImpl = async (args, cwd) => {
        if (args[0] === "api") {
          return "octo";
        }
        if (args[0] === "repo" && args[1] === "view") {
          throw "Could not resolve to a Repository";
        }
        if (args[0] === "repo" && args[1] === "clone") {
          cloneAttempts++;
          if (cloneAttempts < 3) {
            throw "repository is empty";
          }
          fs.mkdirSync(path.resolve(cwd, args[3], ".git"), { recursive: true });
        }

        return "";
      };
      const blueprint = templated();
      const run = await finish(
        await create.createProjectFromBlueprint({
          blueprintId: blueprint.id,
          name: "tally",
          description: "",
        }),
      );

      expect(run.status).toBe("done");
      expect(cloneAttempts).toBe(3);
      expect(run.repo_url).toBe("https://github.com/octo/tally");
      expect(ghCalls.map((a) => a.slice(0, 2).join(" "))).toEqual([
        "auth status",
        "api user",
        "repo view",
        "repo create",
        "repo clone",
        "repo clone",
        "repo clone",
      ]);
      expect(ghCalls[3]).toEqual([
        "repo",
        "create",
        "octo/tally",
        "--public",
        "--template",
        "me/template",
      ]);
    });

    it("refuses a repository name that is taken", async () => {
      ghImpl = async () => "octo";
      const blueprint = templated();
      const run = await finish(
        await create.createProjectFromBlueprint({
          blueprintId: blueprint.id,
          name: "tally",
          description: "",
        }),
      );
      expect(run.steps[0].error).toBe("github.com/octo/tally already exists.");
      expect(ghCalls.some((a) => a[1] === "create")).toBe(false);
    });

    it("keeps earlier steps when a later one fails, and names what it left", async () => {
      ghImpl = async (args) => {
        if (args[0] === "api") {
          return "octo";
        }
        if (args[1] === "view" || args[1] === "clone") {
          throw "still generating";
        }

        return "";
      };
      create.cloneRetry.attempts = 2;
      const blueprint = templated();
      const run = await finish(
        await create.createProjectFromBlueprint({
          blueprintId: blueprint.id,
          name: "tally",
          description: "",
        }),
      );
      create.cloneRetry.attempts = 10;

      expect(stepStatuses(run)).toEqual({
        validate: "done",
        create_repo: "failed",
        register: "pending",
        start_agent: "pending",
      });
      expect(run.steps[1].error).toBe(
        "still generating The repository https://github.com/octo/tally was already created and left in place.",
      );
      expect(capture).toHaveBeenCalledWith(
        "blueprint_project_created",
        expect.objectContaining({ success: false, failed_step: "create_repo" }),
      );
    });
  });
});
