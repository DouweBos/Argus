import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: { sessions: new Map<string, { path: string }>() },
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { appState } = await import("../../state");
const { capture } = await import("../telemetry/telemetry");
const { saveSessionAttachment, sizeBucket, typeBucket } =
  await import("./sessionAttachments");
const { MAX_BASE64_UPLOAD_BYTES } = await import("./uploads");

let repo: string;

const base64Of = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

describe("saveSessionAttachment", () => {
  beforeEach(async () => {
    repo = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-attach-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    appState.sessions.clear();
    appState.sessions.set("s1", { path: repo } as never);
  });

  afterEach(async () => {
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  it("saves into the worktree, out of git's sight", async () => {
    const saved = await saveSessionAttachment("s1", "spec.pdf", base64Of(8));
    expect(saved.relative_path).toMatch(
      /^\.argus\/attachments\/[0-9a-f]{8}\/spec\.pdf$/,
    );
    expect(saved.path).toBe(path.join(repo, saved.relative_path));
    await expect(fs.promises.readFile(saved.path)).resolves.toHaveLength(8);
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(status).toBe("");
    expect(capture).toHaveBeenCalledWith("session_attachment_saved", {
      type_bucket: "document",
      size_bucket: "<100KB",
    });
  });

  it("adds the exclude line once", async () => {
    await saveSessionAttachment("s1", "a.txt", base64Of(1));
    await saveSessionAttachment("s1", "b.txt", base64Of(1));
    const exclude = await fs.promises.readFile(
      path.join(repo, ".git", "info", "exclude"),
      "utf8",
    );
    expect(
      exclude.split("\n").filter((l) => l === "/.argus/attachments/"),
    ).toHaveLength(1);
  });

  it("keeps a hostile name inside its directory", async () => {
    const saved = await saveSessionAttachment(
      "s1",
      "../../etc/passwd",
      base64Of(4),
    );
    expect(saved.name).toBe("passwd");
    expect(
      saved.path.startsWith(path.join(repo, ".argus", "attachments")),
    ).toBe(true);
  });

  it("refuses more than one frame carries", async () => {
    await expect(
      saveSessionAttachment(
        "s1",
        "big.bin",
        base64Of(MAX_BASE64_UPLOAD_BYTES + 1),
      ),
    ).rejects.toMatch(/larger than the 8 MB attachment limit/);
  });

  it("refuses an unknown session", async () => {
    await expect(
      saveSessionAttachment("nope", "a.txt", base64Of(4)),
    ).rejects.toMatch(/Session not found/);
  });

  it("buckets by extension and size", () => {
    expect(typeBucket("Notes.MD")).toBe("text");
    expect(typeBucket("thing")).toBe("other");
    expect(sizeBucket(2 * 1024 * 1024)).toBe("<5MB");
  });
});
