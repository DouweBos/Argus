/**
 * Attachment uploads: the size cap is the host's, not the client's, so an
 * oversize payload is refused here even when a client skipped its own check.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: { sessions: new Map<string, { path: string }>() },
}));

const { appState } = await import("../../state");
const { MAX_BASE64_UPLOAD_BYTES, uploadSessionAttachment } =
  await import("./uploads");

let home: string;

const base64Of = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

describe("uploadSessionAttachment", () => {
  beforeEach(async () => {
    home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-home-"));
    process.env.ARGUS_HOME = home;
    appState.sessions.clear();
    appState.sessions.set("s1", { path: home } as never);
  });

  afterEach(async () => {
    delete process.env.ARGUS_HOME;
    await fs.promises.rm(home, { recursive: true, force: true });
  });

  it("stages the bytes and returns a host path", async () => {
    const result = await uploadSessionAttachment(
      "s1",
      "notes.txt",
      base64Of(8),
    );
    expect(result.size).toBe(8);
    expect(result.path.startsWith(path.join(home, "uploads", "s1"))).toBe(true);
    await expect(fs.promises.readFile(result.path)).resolves.toHaveLength(8);
  });

  it("refuses a payload larger than one base64 envelope", async () => {
    await expect(
      uploadSessionAttachment(
        "s1",
        "huge.bin",
        base64Of(MAX_BASE64_UPLOAD_BYTES + 1),
      ),
    ).rejects.toMatch(/larger than the 8 MB attachment limit/);
  });

  it("refuses an unknown session", async () => {
    await expect(
      uploadSessionAttachment("nope", "a.txt", base64Of(4)),
    ).rejects.toMatch(/Session not found/);
  });

  it("strips directories from a client-supplied name", async () => {
    const result = await uploadSessionAttachment(
      "s1",
      "../../etc/passwd",
      base64Of(4),
    );
    expect(path.basename(result.path)).toBe("passwd");
    expect(result.path.startsWith(path.join(home, "uploads", "s1"))).toBe(true);
  });
});
