/**
 * Path containment for the @-mention browser: a remote caller passes the roots
 * it may browse, and nothing outside them resolves — while cross-project
 * mentions into other registered projects keep working.
 */

import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: { sessions: new Map<string, { path: string }>() },
}));
vi.mock("../session/git", () => ({ git: vi.fn(async () => "") }));

const { appState } = await import("../../state");
const { resolveMentionPath } = await import("./operations");

const WORKTREE = path.join(os.tmpdir(), "argus-mention-session");
const OTHER_PROJECT = path.join(os.tmpdir(), "argus-mention-other");

describe("resolveMentionPath containment", () => {
  beforeEach(() => {
    appState.sessions.clear();
    appState.sessions.set("s1", { path: WORKTREE } as never);
  });

  it("rejects paths outside the session and the allowed project roots", async () => {
    for (const query of ["~/.ssh/", "/etc/", "../../"]) {
      const res = await resolveMentionPath("s1", query, [OTHER_PROJECT]);
      expect(res.entries).toEqual([]);
      expect(res.resolvedPath).toBe(WORKTREE);
    }
  });

  it("still allows another registered project", async () => {
    const res = await resolveMentionPath("s1", `${OTHER_PROJECT}/`, [
      OTHER_PROJECT,
    ]);
    expect(res.resolvedPath).toBe(OTHER_PROJECT);
  });

  it("leaves the local (unconfined) browse alone", async () => {
    const res = await resolveMentionPath("s1", "/etc/");
    expect(res.resolvedPath).toBe("/etc");
  });
});
