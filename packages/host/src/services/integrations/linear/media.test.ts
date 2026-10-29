import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-media-"));
vi.mock("../../../lib/argusHome", () => ({ argusHomeDir: () => home }));

const { cacheLinearMedia, isLinearUpload } = await import("./media");

describe("cacheLinearMedia", () => {
  beforeEach(() =>
    fs.rmSync(path.join(home, "cache"), { recursive: true, force: true }),
  );
  afterEach(() => vi.unstubAllGlobals());

  it("downloads once with the credential and serves the cache after", async () => {
    const fetchSpy = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "video/quicktime" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const url = "https://uploads.linear.app/a/b/clip.mov";

    const first = await cacheLinearMedia(url, "lin_api_key");
    const second = await cacheLinearMedia(url, "lin_api_key");

    expect(first).toEqual(second);
    expect(first.mimeType).toBe("video/quicktime");
    expect(first.path.endsWith(".mov")).toBe(true);
    expect([...fs.readFileSync(first.path)]).toEqual([1, 2, 3]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({
      authorization: "lin_api_key",
    });
  });

  it("refuses file types it can't show", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("x", { headers: { "content-type": "application/zip" } }),
        ),
      ),
    );
    await expect(
      cacheLinearMedia("https://uploads.linear.app/x.zip", "k"),
    ).rejects.toThrow(/can't show application\/zip/);
  });
});

describe("isLinearUpload", () => {
  it("only accepts Linear's upload host", () => {
    expect(isLinearUpload("https://uploads.linear.app/a.mov")).toBe(true);
    expect(
      isLinearUpload("https://evil.example/uploads.linear.app/a.mov"),
    ).toBe(false);
  });
});
