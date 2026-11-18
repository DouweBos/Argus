import type { Blueprint, BlueprintRun } from "@argus/remote-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { addHostEventSink, resetHostEventSinks } =
  await import("@argus/host/bus");
const manager = await import("./manager");
const store = await import("./store");

let home: string;
let previousHome: string | undefined;

function blueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: "b1",
    name: "Mac app",
    summary: "A SwiftUI Mac app",
    parent_dir: "~/Work/Apps",
    references: [{ path: "/repos/ref", note: "release workflow" }],
    scaffold: { kind: "github_template", repo: "me/template" },
    github: { enabled: true, owner: "", visibility: "private" },
    copy_project_settings_from: "/repos/ref",
    instructions: "Build {{name}}",
    agent: { runner: null, model: "opus", permission_mode: "auto" },
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function run(id: string, startedAt: number): BlueprintRun {
  return {
    id,
    blueprint_id: "b1",
    project_name: id,
    repo_root: `/apps/${id}`,
    repo_url: null,
    status: "done",
    steps: [],
    session_id: null,
    agent_id: null,
    started_at: startedAt,
    finished_at: startedAt,
  };
}

describe("blueprints on disk", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-blueprints-"));
    process.env.ARGUS_HOME = home;
    manager.resetBlueprintCache();
  });

  afterEach(() => {
    process.env.ARGUS_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe("blueprint store", () => {
    it("round-trips blueprints", () => {
      store.saveBlueprints([blueprint()]);
      expect(store.loadBlueprints()).toEqual([blueprint()]);
    });

    it("keeps the newest runs only", () => {
      const runs = Array.from(
        { length: store.MAX_BLUEPRINT_RUNS + 5 },
        (_, i) => run(`r${i}`, i),
      );
      const kept = store.saveBlueprintRuns(runs);
      expect(kept).toHaveLength(store.MAX_BLUEPRINT_RUNS);
      expect(kept[0].id).toBe(`r${store.MAX_BLUEPRINT_RUNS + 4}`);
      expect(store.loadBlueprintRuns()).toEqual(kept);
    });
  });

  describe("blueprint manager", () => {
    it("creates, updates and deletes through to disk", () => {
      const { id: _id, created_at: _c, updated_at: _u, ...input } = blueprint();
      const created = manager.createBlueprint(input);
      manager.resetBlueprintCache();
      expect(manager.listBlueprints()).toEqual([created]);

      const updated = manager.updateBlueprint(created.id, {
        name: " Renamed ",
      });
      expect(updated.name).toBe("Renamed");
      expect(updated.created_at).toBe(created.created_at);

      manager.deleteBlueprint(created.id);
      manager.resetBlueprintCache();
      expect(manager.listBlueprints()).toEqual([]);
    });

    it("refuses to copy settings from a project that is not a reference", () => {
      const {
        id: _id,
        created_at: _c,
        updated_at: _u,
        ...input
      } = blueprint({
        copy_project_settings_from: "/elsewhere",
      });
      expect(() => manager.createBlueprint(input)).toThrow(/references/);
    });

    it("fails runs the host died during", () => {
      store.saveBlueprintRuns([
        {
          ...run("r1", 1),
          status: "running",
          finished_at: null,
          steps: [{ key: "create_repo", status: "running", error: null }],
        },
      ]);
      manager.initBlueprints();
      const [after] = manager.listBlueprintRuns();
      expect(after.status).toBe("failed");
      expect(after.steps[0].status).toBe("failed");
    });

    it("emits on every write", () => {
      const channels: string[] = [];
      addHostEventSink((channel) => channels.push(channel));
      const { id: _id, created_at: _c, updated_at: _u, ...input } = blueprint();
      manager.createBlueprint(input);
      manager.saveBlueprintRun(run("r2", 2));
      resetHostEventSinks();
      expect(channels).toEqual(["blueprints:changed", "blueprint_run:changed"]);
    });
  });
});
