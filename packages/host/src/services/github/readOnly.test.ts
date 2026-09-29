import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Callback = (err: unknown, result?: { stdout: string }) => void;

const gh = vi.hoisted(() => ({
  calls: [] as string[][],
  onCall: (_args: string[]): { stdout?: string; error?: unknown } => ({
    stdout: "",
  }),
}));

vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: Callback) => {
    gh.calls.push(args);
    const { stdout = "", error } = gh.onCall(args);
    if (error) {
      cb(error);
    } else {
      cb(null, { stdout });
    }
  },
}));

const {
  MAX_OUTPUT_CHARS,
  filterLines,
  githubGet,
  searchGithubArtifact,
  validateApiPath,
} = await import("./readOnly");

describe("validateApiPath", () => {
  it("accepts REST paths and strips a leading slash", () => {
    expect(validateApiPath("/repos/o/r/actions/runs?per_page=5")).toBe(
      "repos/o/r/actions/runs?per_page=5",
    );
  });

  it.each([
    ["an empty path", ""],
    ["a flag", "-XPOST"],
    ["whitespace smuggling a flag", "repos/o/r -X POST"],
    ["GraphQL", "graphql"],
    ["GraphQL with a query", "graphql?query=x"],
  ])("rejects %s", (_name, apiPath) => {
    expect(() => validateApiPath(apiPath)).toThrow();
  });
});

describe("filterLines", () => {
  it("returns the text untouched without a pattern", () => {
    expect(filterLines("a\nb", undefined, 1)).toBe("a\nb");
  });

  it("keeps matching lines case-insensitively and counts the rest", () => {
    expect(filterLines("GET 429\nok\nget 429\nget 429", "get 429", 2)).toBe(
      "GET 429\nget 429\n… 1 more matching lines",
    );
  });

  it("rejects a broken regex", () => {
    expect(() => filterLines("a", "(", 1)).toThrow("Invalid pattern");
  });
});

describe("githubGet", () => {
  beforeEach(() => {
    gh.calls.length = 0;
  });

  it("always sends a GET, whatever the path", async () => {
    gh.onCall = () => ({ stdout: "{}" });

    await githubGet({
      path: "repos/o/r/actions/jobs/1/logs",
      jq: ".x",
      paginate: true,
      maxLines: 10,
    });

    expect(gh.calls[0]).toEqual([
      "api",
      "--method",
      "GET",
      "repos/o/r/actions/jobs/1/logs",
      "--paginate",
      "--jq",
      ".x",
    ]);
  });

  it("filters a long log down to what matches", async () => {
    gh.onCall = () => ({ stdout: "step 1\nGET 429 trending\nstep 2" });

    const text = await githubGet({
      path: "repos/o/r/actions/jobs/1/logs",
      pattern: "429",
      maxLines: 10,
    });

    expect(text).toBe("GET 429 trending");
  });

  it("truncates what it hands back", async () => {
    gh.onCall = () => ({ stdout: "x".repeat(MAX_OUTPUT_CHARS + 10) });

    const text = await githubGet({ path: "repos/o/r", maxLines: 10 });

    expect(text).toContain("truncated");
    expect(text.length).toBeLessThan(MAX_OUTPUT_CHARS + 200);
  });

  it("surfaces gh's own error", async () => {
    gh.onCall = () => ({ error: { stderr: "HTTP 404: Not Found\n" } });

    await expect(githubGet({ path: "repos/o/r", maxLines: 10 })).rejects.toBe(
      "HTTP 404: Not Found",
    );
  });

  it("never runs gh for a rejected path", async () => {
    await expect(
      githubGet({ path: "--method=POST", maxLines: 10 }),
    ).rejects.toBeTruthy();
    expect(gh.calls).toHaveLength(0);
  });
});

describe("searchGithubArtifact", () => {
  let downloadDir: string | null = null;

  beforeEach(() => {
    gh.calls.length = 0;
    downloadDir = null;
    gh.onCall = (args) => {
      const dir = args[args.indexOf("-D") + 1]!;
      downloadDir = dir;
      fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "logs", "device.log"),
        "boot\n[fetchJson] GET 429 /hubs/discover/trending\nidle\n",
      );
      fs.writeFileSync(
        path.join(dir, "screenshot.png"),
        Buffer.from([0x89, 0x50, 0x00, 0x01, 0x34, 0x32, 0x39]),
      );

      return { stdout: "" };
    };
  });

  const search = (
    overrides: Partial<Parameters<typeof searchGithubArtifact>[0]> = {},
  ) =>
    searchGithubArtifact({
      repo: "plexinc/app",
      runId: "36514387031",
      artifact: "maestro-results-android-phone",
      pattern: "GET 429",
      maxLines: 50,
      ...overrides,
    });

  it("returns file:line matches and deletes the download", async () => {
    const text = await search();

    expect(text).toBe(
      "logs/device.log:2: [fetchJson] GET 429 /hubs/discover/trending",
    );
    expect(gh.calls[0]).toEqual([
      "run",
      "download",
      "36514387031",
      "-R",
      "plexinc/app",
      "-n",
      "maestro-results-android-phone",
      "-D",
      downloadDir,
    ]);
    expect(fs.existsSync(downloadDir!)).toBe(false);
  });

  it("skips binary files", async () => {
    await expect(search({ pattern: "429" })).resolves.not.toContain(
      "screenshot.png",
    );
  });

  it("says so when nothing matches", async () => {
    await expect(search({ pattern: "ANR" })).resolves.toContain(
      "No lines match",
    );
  });

  it("cleans up when the download fails", async () => {
    gh.onCall = (args) => {
      downloadDir = args[args.indexOf("-D") + 1]!;

      return { error: { stderr: "no artifact matches" } };
    };

    await expect(search()).rejects.toBe("no artifact matches");
    expect(fs.existsSync(downloadDir!)).toBe(false);
  });

  it.each([
    ["a repo that isn't owner/name", { repo: "plexinc" }],
    ["a run id that isn't a number", { runId: "--help" }],
    ["an artifact name that is a flag", { artifact: "-Dsomewhere" }],
    ["a broken pattern", { pattern: "(" }],
  ])("refuses %s without running gh", async (_name, overrides) => {
    await expect(search(overrides)).rejects.toBeTruthy();
    expect(gh.calls).toHaveLength(0);
  });
});
