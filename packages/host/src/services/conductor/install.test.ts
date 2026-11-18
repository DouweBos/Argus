import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { shimBinPath, writeShim } from "./install";

const POOLED_ID = "web:chromium:abc123";

let dir: string;
let server: Server;
let resolverUrl: string;
let resolverCalls: string[];

function runShim(
  args: string[],
): Promise<{ code: number | null; argv: string[] | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [shimBinPath(dir), ...args], {
      env: {
        ...process.env,
        ARGUS_RESOLVER_URL: resolverUrl,
        ARGUS_AGENT_ID: "agent-1",
        ARGUS_RESOLVER_TOKEN: "token",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("exit", (code) =>
      resolve({ code, argv: stdout ? JSON.parse(stdout) : null, stderr }),
    );
  });
}

describe("conductor shim", () => {
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "conductor-shim-"));
    writeShim(dir);
    const entryDir = path.join(
      dir,
      "node_modules",
      "@houwert",
      "conductor",
      "dist",
    );
    mkdirSync(entryDir, { recursive: true });
    writeFileSync(
      path.join(entryDir, "index.js"),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
    );
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        resolverCalls.push(JSON.parse(body).platform);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ device_id: POOLED_ID }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    resolverUrl = `http://127.0.0.1:${port}/argus/acquire-device`;
  });

  beforeEach(() => {
    resolverCalls = [];
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("swaps --device web for the pooled browser", async () => {
    const r = await runShim(["--device", "web", "screenshot"]);
    expect(r.code).toBe(0);
    expect(r.argv).toEqual(["--device", POOLED_ID, "screenshot"]);
    expect(resolverCalls).toEqual(["web"]);
  });

  it("rewrites the joined --device=<value> form", async () => {
    const r = await runShim(["--device=web:chromium", "screenshot"]);
    expect(r.code).toBe(0);
    expect(r.argv).toEqual([`--device=${POOLED_ID}`, "screenshot"]);
    expect(resolverCalls).toEqual(["web"]);
  });

  it("passes fully-qualified ids through", async () => {
    const r = await runShim(["--device=web:chromium:mine", "screenshot"]);
    expect(r.argv).toEqual(["--device=web:chromium:mine", "screenshot"]);
    expect(resolverCalls).toEqual([]);
  });

  it.each([
    [["--device", "web:chromium", "--cdp-url", "http://127.0.0.1:9222", "x"]],
    [["--device", "web", "--cdp-target=T1", "x"]],
    [["--device=web:chromium", "--cdp-url=http://127.0.0.1:9222", "x"]],
  ])("refuses to attach the pooled browser over CDP: %j", async (args) => {
    const r = await runShim(args);
    expect(r.code).toBe(1);
    expect(r.argv).toBeNull();
    expect(r.stderr).toContain("web:chromium:<label>");
    expect(r.stderr).toContain("web:cdp:<port>:<targetId>");
    expect(resolverCalls).toEqual([]);
  });

  it("lets a fully-qualified device use CDP flags", async () => {
    const args = [
      "--device",
      "web:cdp:9222:T1",
      "--cdp-url",
      "http://127.0.0.1:9222",
      "--cdp-target",
      "T1",
      "x",
    ];
    const r = await runShim(args);
    expect(r.code).toBe(0);
    expect(r.argv).toEqual(args);
    expect(resolverCalls).toEqual([]);
  });
});
