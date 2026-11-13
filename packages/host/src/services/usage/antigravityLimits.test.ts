import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAntigravityLimits } from "./antigravityLimits";

const NOW = Date.UTC(2026, 10, 11, 12);
const TOKEN = {
  client_id: "id",
  client_secret: "secret",
  refresh_token: "refresh",
};

describe("readAntigravityLimits", () => {
  let home: string;
  const fetchMock = vi.fn<typeof fetch>();
  const write = (name: string, value: unknown) => {
    fs.mkdirSync(path.join(home, "antigravity-acp"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "antigravity-acp", name),
      JSON.stringify(value),
    );
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-limits-"));
    vi.stubEnv("GEMINI_HOME", home);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("asks for a sign-in when there is no token", async () => {
    await expect(readAntigravityLimits(NOW)).resolves.toMatchObject({
      status: "unsupported",
      message: "Run `agy acp --login` to see plan limits.",
    });
  });

  it("has no limits on an API key", async () => {
    write("settings.json", { auth: { type: "gemini-api-key" } });
    write("acp_token.json", TOKEN);
    await expect(readAntigravityLimits(NOW)).resolves.toMatchObject({
      status: "unsupported",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes the token and merges both endpoints' buckets", async () => {
    write("acp_token.json", { ...TOKEN, project_id: "p" });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("https://oauth2")) {
        return Promise.resolve(Response.json({ access_token: "access" }));
      }
      const id = url.includes("daily-") ? "gemini-5h" : "3p-weekly";

      return Promise.resolve(
        Response.json({
          buckets: [
            { bucketId: id, window: "weekly", remainingFraction: 0.5 },
            {
              bucketId: "shared",
              remainingFraction: url.includes("daily-") ? 0.1 : 0.9,
            },
          ],
        }),
      );
    });
    const reading = await readAntigravityLimits(NOW);
    expect(reading.status).toBe("ok");
    expect(reading.windows.map((w) => [w.id, w.used_percent])).toEqual([
      ["gemini-5h", 50],
      ["shared", 90],
      ["3p-weekly", 50],
    ]);
    const quotaCall = fetchMock.mock.calls[1]?.[1];
    expect(quotaCall?.body).toBe(JSON.stringify({ project: "p" }));
  });

  it("reports an expired sign-in", async () => {
    write("acp_token.json", TOKEN);
    fetchMock.mockResolvedValue(new Response("", { status: 400 }));
    await expect(readAntigravityLimits(NOW)).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("fails when no quota endpoint answers", async () => {
    write("acp_token.json", TOKEN);
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        String(input).startsWith("https://oauth2")
          ? Response.json({ access_token: "access" })
          : new Response("", { status: 500 }),
      ),
    );
    await expect(readAntigravityLimits(NOW)).rejects.toThrow();
  });
});
