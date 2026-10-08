/**
 * The editor's versioned file IO: reads report why a file is read-only instead
 * of throwing, and writes refuse to clobber a file that moved on.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));
vi.mock("../session/git", () => ({ git: vi.fn(async () => "") }));

const { appState } = await import("../../state");
const { readCodeFile, sha1, writeCodeFile, onCodeFileWritten } =
  await import("./files");

let worktree: string;

const file = (rel: string) => path.join(worktree, rel);

describe("code editor file IO", () => {
  beforeEach(async () => {
    worktree = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-code-")),
    );
    appState.sessions.clear();
    appState.sessions.set("s1", { path: worktree } as never);
  });

  afterEach(async () => {
    await fs.promises.rm(worktree, { recursive: true, force: true });
  });

  describe("read", () => {
    it("returns content, hash, size and line endings", async () => {
      await fs.promises.writeFile(file("a.txt"), "one\r\ntwo\r\n");
      const read = await readCodeFile("s1", "a.txt");
      expect(read).toMatchObject({
        content: "one\r\ntwo\r\n",
        hash: sha1(Buffer.from("one\r\ntwo\r\n")),
        size: 10,
        eol: "crlf",
      });
      expect(read.readOnlyReason).toBeUndefined();
      expect((await readCodeFile("s1", "a.txt")).mtimeMs).toBe(
        fs.statSync(file("a.txt")).mtimeMs,
      );
    });

    it("reports binary, non-UTF-8 and oversized files instead of throwing", async () => {
      await fs.promises.writeFile(file("bin"), Buffer.from([1, 0, 2]));
      await fs.promises.writeFile(file("latin1"), Buffer.from([0x63, 0xe9]));
      await fs.promises.writeFile(
        file("big"),
        Buffer.alloc(5 * 1024 * 1024 + 1, 97),
      );
      for (const [name, reason] of [
        ["bin", "binary"],
        ["latin1", "encoding"],
        ["big", "too_large"],
      ]) {
        const read = await readCodeFile("s1", name);
        expect(read.readOnlyReason).toBe(reason);
        expect(read.content).toBe("");
        expect(read.hash).toMatch(/^[0-9a-f]{40}$/);
      }
    });

    it("refuses paths outside the session", async () => {
      await expect(readCodeFile("s1", "/etc/hosts")).rejects.toMatch(/outside/);
    });
  });

  describe("write", () => {
    it("writes when the base matches and returns the new version", async () => {
      await fs.promises.writeFile(file("a.txt"), "old");
      const result = await writeCodeFile(
        "s1",
        "a.txt",
        "new",
        sha1(Buffer.from("old")),
      );
      expect(result).toMatchObject({
        ok: true,
        hash: sha1(Buffer.from("new")),
      });
      expect(fs.readFileSync(file("a.txt"), "utf8")).toBe("new");
    });

    it("reports a conflict and leaves the file alone when it moved on", async () => {
      await fs.promises.writeFile(file("a.txt"), "agent wrote this");
      const result = await writeCodeFile("s1", "a.txt", "mine", "stale");
      expect(result).toEqual({
        ok: false,
        conflict: {
          hash: sha1(Buffer.from("agent wrote this")),
          mtimeMs: fs.statSync(file("a.txt")).mtimeMs,
        },
      });
      expect(fs.readFileSync(file("a.txt"), "utf8")).toBe("agent wrote this");
    });

    it("overwrites a conflict when forced", async () => {
      await fs.promises.writeFile(file("a.txt"), "theirs");
      const result = await writeCodeFile("s1", "a.txt", "mine", "stale", true);
      expect(result.ok).toBe(true);
      expect(fs.readFileSync(file("a.txt"), "utf8")).toBe("mine");
    });

    it("treats a null base as 'must not exist', creating parents", async () => {
      expect((await writeCodeFile("s1", "new/dir/f.ts", "x", null)).ok).toBe(
        true,
      );
      expect(fs.readFileSync(file("new/dir/f.ts"), "utf8")).toBe("x");
      await expect(
        writeCodeFile("s1", "new/dir/f.ts", "y", null),
      ).resolves.toMatchObject({
        ok: false,
        conflict: { hash: sha1(Buffer.from("x")) },
      });
    });

    it("conflicts when the file it expected was deleted", async () => {
      await expect(
        writeCodeFile("s1", "gone.txt", "x", "abc"),
      ).resolves.toEqual({
        ok: false,
        conflict: { hash: null, mtimeMs: null },
      });
    });

    it("is atomic: keeps the mode and leaves no temp file behind", async () => {
      await fs.promises.writeFile(file("run.sh"), "#!/bin/sh\n");
      await fs.promises.chmod(file("run.sh"), 0o755);
      const before = fs.statSync(file("run.sh")).ino;
      await writeCodeFile(
        "s1",
        "run.sh",
        "#!/bin/sh\necho hi\n",
        sha1(Buffer.from("#!/bin/sh\n")),
      );
      const after = fs.statSync(file("run.sh"));
      expect(after.mode & 0o777).toBe(0o755);
      // Renamed over, not rewritten in place.
      expect(after.ino).not.toBe(before);
      expect(fs.readdirSync(worktree)).toEqual(["run.sh"]);
    });

    it("serialises concurrent saves so only one passes the base check", async () => {
      await fs.promises.writeFile(file("a.txt"), "base");
      const base = sha1(Buffer.from("base"));
      const results = await Promise.all([
        writeCodeFile("s1", "a.txt", "first", base),
        writeCodeFile("s1", "a.txt", "second", base),
      ]);
      expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
    });

    it("tells listeners about the new hash", async () => {
      const seen: string[] = [];
      const stop = onCodeFileWritten((_id, absolute, hash) => {
        seen.push(`${path.basename(absolute)}:${hash}`);
      });
      await writeCodeFile("s1", "b.txt", "b", null);
      stop();
      expect(seen).toEqual([`b.txt:${sha1(Buffer.from("b"))}`]);
    });
  });
});
