import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("../integrations/service", () => ({ linearApi: () => null }));
vi.mock("../integrations/figma/service", () => ({ figmaApi: () => null }));

const {
  buildIntegrationsSection,
  buildRelatedProjectsSection,
  relatedProjectsContext,
} = await import("./contextPrompt");

describe("buildIntegrationsSection", () => {
  it("is absent when nothing is connected", () => {
    expect(
      buildIntegrationsSection({
        linear: false,
        figma: false,
        deviceControl: true,
      }),
    ).toBeNull();
  });

  it("reads the ticket with its designs, then compares after the last change", () => {
    const text = buildIntegrationsSection({
      linear: true,
      figma: true,
      deviceControl: true,
    })!;
    expect(text).toContain("`linear_get_issue`");
    expect(text).toContain("`figma_get_frame`");
    expect(text).toContain("`design_compare`");
    expect(text).toMatch(/after your last code change/i);
  });

  it("names only the connected service", () => {
    const linear = buildIntegrationsSection({
      linear: true,
      figma: false,
      deviceControl: true,
    })!;
    expect(linear).toContain("`linear_get_issue`");
    expect(linear).not.toContain("figma");
    expect(linear).not.toContain("design_compare");

    const figma = buildIntegrationsSection({
      linear: false,
      figma: true,
      deviceControl: true,
    })!;
    expect(figma).not.toContain("linear_get_issue");
    expect(figma).toContain("`design_compare`");
  });

  it("leaves design_compare out without device control", () => {
    const text = buildIntegrationsSection({
      linear: true,
      figma: true,
      deviceControl: false,
    })!;
    expect(text).toContain("`figma_get_frame`");
    expect(text).not.toContain("design_compare");
  });
});

describe("buildRelatedProjectsSection", () => {
  it("is absent without related projects", () => {
    expect(buildRelatedProjectsSection([])).toBeNull();
  });

  it("lists each project's run commands and sessions for trigger_run", () => {
    const text = buildRelatedProjectsSection([
      {
        path: "/work/api",
        description: "Backend API",
        runCommands: [{ title: "api", command: "pnpm dev" }],
        worktrees: ["fix-auth-ab12"],
      },
      {
        path: "/work/docs",
        description: "Docs site",
        runCommands: [],
        worktrees: [],
      },
    ])!;
    expect(text).toContain("`trigger_run`");
    expect(text).toContain("never as a Bash background process");
    expect(text).toContain("- **Backend API** — `/work/api`");
    expect(text).toContain("`api` (`pnpm dev`)");
    expect(text).toContain("Worktrees besides `root`: `fix-auth-ab12`");
    expect(text).toContain("No run commands configured.");
  });

  it("cuts a long worktree list", () => {
    const text = buildRelatedProjectsSection([
      {
        path: "/work/api",
        description: "Backend API",
        runCommands: [],
        worktrees: ["a", "b", "c", "d", "e", "f", "g"],
      },
    ])!;
    expect(text).toContain("and 2 more (`list_sessions`)");
  });
});

describe("relatedProjectsContext", () => {
  const dirs: string[] = [];
  afterEach(() => {
    appState.sessions.clear();
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("reads the related project's own run commands and worktrees", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "related-"));
    dirs.push(root);
    const app = path.join(root, "app");
    const api = path.join(root, "api");
    fs.mkdirSync(app);
    fs.mkdirSync(api);
    fs.writeFileSync(
      path.join(app, ".argus.json"),
      JSON.stringify({
        related_projects: [{ path: "../api", description: "Backend API" }],
      }),
    );
    fs.writeFileSync(
      path.join(api, ".argus.json"),
      JSON.stringify({ run: [{ title: "api", command: "pnpm dev" }] }),
    );
    appState.sessions.set("s1", {
      id: "s1",
      repo_root: api,
      kind: "worktree",
      branch: "fix-auth",
    } as never);

    expect(relatedProjectsContext(app)).toEqual([
      {
        path: api,
        description: "Backend API",
        runCommands: [{ title: "api", command: "pnpm dev" }],
        worktrees: ["fix-auth"],
      },
    ]);
  });
});
