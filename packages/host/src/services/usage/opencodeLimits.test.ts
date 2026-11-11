import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  opencodeAuthKey,
  opencodeStoredKey,
  readOpencodeLimits,
} from "./opencodeLimits";

const NOW = Date.UTC(2026, 10, 11, 12);

describe("opencodeAuthKey", () => {
  it("prefers the saved Go key over the environment", () => {
    const auth = JSON.stringify({
      "opencode-go": { type: "api", key: " k1 " },
    });
    expect(opencodeAuthKey(auth, { OPENCODE_API_KEY: "env" })).toBe("k1");
    expect(opencodeAuthKey("{}", { OPENCODE_API_KEY: "env" })).toBe("env");
    expect(
      opencodeAuthKey(
        JSON.stringify({ "opencode-go": { type: "oauth", key: "x" } }),
        {},
      ),
    ).toBeNull();
    expect(opencodeAuthKey("not json", {})).toBeNull();
  });
});

describe("opencodeStoredKey", () => {
  it("accepts keys for the hosted Console only", () => {
    const stored = (server?: string) =>
      JSON.stringify({
        type: "key",
        key: "k",
        metadata: server ? { server } : null,
      });
    expect(opencodeStoredKey(stored())).toBe("k");
    expect(opencodeStoredKey(stored("https://opencode.ai/console/"))).toBe("k");
    expect(opencodeStoredKey(stored("https://example.com/console"))).toBeNull();
    expect(opencodeStoredKey(JSON.stringify({ type: "oauth" }))).toBeNull();
    expect(opencodeStoredKey(undefined)).toBeNull();
  });
});

describe("readOpencodeLimits", () => {
  let dir: string;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-limits-"));
    vi.stubEnv("XDG_DATA_HOME", dir);
    vi.stubEnv("OPENCODE_API_KEY", "");
    vi.stubEnv("OPENCODE_AUTH_CONTENT", "");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("asks for a Go key when there is none", async () => {
    await expect(readOpencodeLimits(NOW)).resolves.toMatchObject({
      status: "unsupported",
      message: "Add an OpenCode Go API key to see plan limits.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the allowance with the environment's key", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "go-key");
    fetchMock.mockResolvedValue(
      Response.json({
        usage: {
          rolling: { percent: 10, resetsAt: "2026-11-11T13:00:00Z" },
          weekly: { percent: 20, resetsAt: "2026-11-16T00:00:00Z" },
          monthly: { percent: 30, resetsAt: "2026-12-01T00:00:00Z" },
        },
      }),
    );
    const reading = await readOpencodeLimits(NOW);
    expect(reading).toMatchObject({ status: "ok", plan: "Go" });
    expect(reading.windows.map((w) => w.used_percent)).toEqual([10, 20, 30]);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer go-key",
    });
  });

  it("calls a key without a Go subscription unsupported", async () => {
    fs.mkdirSync(path.join(dir, "opencode"));
    fs.writeFileSync(
      path.join(dir, "opencode", "auth.json"),
      JSON.stringify({ "opencode-go": { type: "api", key: "zen" } }),
    );
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    await expect(readOpencodeLimits(NOW)).resolves.toMatchObject({
      status: "unsupported",
    });
  });
});
