import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanCliProjects } from "./projectScan";

const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "cli-scan-")),
);
// The temp dir is rightly never a project; nothing else is excluded here.
const excluded: string[] = [];

function repo(
  name: string,
  dotGit: "dir" | "none" | "worktree" = "dir",
): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  if (dotGit === "dir") {
    fs.mkdirSync(path.join(dir, ".git"));
  } else if (dotGit === "worktree") {
    fs.writeFileSync(
      path.join(dir, ".git"),
      "gitdir: /src/app/.git/worktrees/feature\n",
    );
  }

  return dir;
}

function chat(root: string, cwd: string, id: string, mtime: Date): void {
  const dir = path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(
    file,
    `{"type":"summary"}\n{"type":"user","cwd":${JSON.stringify(cwd)}}\n`,
  );
  fs.utimesSync(file, mtime, mtime);
}

describe("scanCliProjects", () => {
  it("groups chats by directory and keeps only real repos", async () => {
    const root = path.join(tmp, "projects");
    const app = repo("app");
    const site = repo("site");
    chat(root, app, "a1", new Date("2026-10-01"));
    chat(root, app, "a2", new Date("2026-10-20"));
    chat(root, site, "s1", new Date("2026-10-10"));
    chat(root, repo("notes", "none"), "n1", new Date("2026-10-25"));
    chat(root, repo("app-wt", "worktree"), "w1", new Date("2026-10-25"));
    chat(root, path.join(tmp, "gone"), "g1", new Date("2026-10-25"));

    const scan = await scanCliProjects(root, excluded);
    expect(scan.truncated).toBe(false);
    expect(scan.candidates).toEqual([
      {
        path: app,
        chatCount: 2,
        lastActiveAt: new Date("2026-10-20").getTime(),
      },
      {
        path: site,
        chatCount: 1,
        lastActiveAt: new Date("2026-10-10").getTime(),
      },
    ]);
  });

  it("is empty without a projects dir", async () => {
    await expect(
      scanCliProjects(path.join(tmp, "missing"), excluded),
    ).resolves.toEqual({
      candidates: [],
      truncated: false,
    });
  });
});
