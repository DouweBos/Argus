import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { appState } from "../../../state";

const settings = { remote_enabled: true, remote_mcp_enabled: true };
vi.mock("../../appSettings/store", () => ({ loadAppSettings: () => settings }));
vi.mock("../../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("@argus/host/platform", () => ({
  hostPlatform: () => ({ notify: vi.fn(), focusUi: vi.fn() }),
}));
const spawned = vi.fn();
vi.mock("../server", () => ({
  createMcpServer: () => {
    const server = new McpServer({ name: "t", version: "1" });
    const text = (t: string) => ({
      content: [{ type: "text" as const, text: t }],
    });
    server.tool("list_projects", {}, async () => text("[]"));
    server.tool(
      "spawn_agent",
      { project_path: z.string(), permission_mode: z.string().optional() },
      async (args) => {
        spawned(args);

        return text("ok");
      },
    );
    server.tool("merge_session", {}, async () => text("merged"));
    server.tool("linear_get_issue", {}, async () => text("secret"));

    return server;
  },
}));

const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-outside-"));
process.env.ARGUS_HOME = home;

const { handleOutsideMcp, closeOutsideSessions } = await import("./endpoint");
const { decideMcpRequest, mcpGrantViews, mcpRequestViews, revokeMcpGrant } =
  await import("./admin");
const { resetOutsideMcpStore } = await import("./store");

let server: http.Server;
let base: string;
const redirect = "http://127.0.0.1:9999/callback";

async function register(): Promise<string> {
  const res = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude Code",
      redirect_uris: [redirect],
    }),
  });
  expect(res.status).toBe(201);

  return ((await res.json()) as { client_id: string }).client_id;
}

/** Runs the whole sign-in, approving at `access`; returns the tokens. */
async function signIn(access: "admin" | "control" | "monitor") {
  const clientId = await register();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const authorize = new URL(`${base}/oauth/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
  })) {
    authorize.searchParams.set(k, v);
  }
  const pageRes = await fetch(authorize, { redirect: "manual" });
  expect(pageRes.status).toBe(200);
  const html = await pageRes.text();
  const [request] = mcpRequestViews();
  expect(html).toContain(request.matchCode);
  expect(request.clientName).toBe("Claude Code");
  const waitUrl = /url=([^"]+)"/.exec(html)![1].replaceAll("&#38;", "&");

  // Not yet approved: still the waiting page.
  expect((await fetch(waitUrl, { redirect: "manual" })).status).toBe(200);
  decideMcpRequest(request.requestId, true, access);
  const back = await fetch(waitUrl, { redirect: "manual" });
  expect(back.status).toBe(302);
  const location = new URL(back.headers.get("location")!);
  expect(location.searchParams.get("state")).toBe("xyz");
  const code = location.searchParams.get("code")!;

  const token = async (body: Record<string, string>) =>
    fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  const exchange = {
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirect,
    code_verifier: verifier,
  };
  const tokens = (await (await token(exchange)).json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
  };
  expect(tokens.scope).toBe(`argus:${access}`);
  // Codes are single use.
  expect((await token(exchange)).status).toBe(400);

  return { ...tokens, clientId, token };
}

async function connect(accessToken: string) {
  const client = new Client({ name: "outside", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );

  return client;
}

describe("outside MCP over OAuth", () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      handleOutsideMcp(req, res).catch(() => undefined);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(() => {
    settings.remote_mcp_enabled = true;
    closeOutsideSessions();
    resetOutsideMcpStore();
    fs.rmSync(path.join(home, "mcp-clients.json"), { force: true });
    appState.repoRoots.clear();
    appState.repoRoots.add("/repo" as never);
    spawned.mockClear();
  });
  afterAll(() => {
    closeOutsideSessions();
    server.close();
  });

  it("publishes discovery metadata", async () => {
    const meta = (await (
      await fetch(`${base}/.well-known/oauth-authorization-server`)
    ).json()) as { code_challenge_methods_supported: string[]; issuer: string };
    expect(meta.issuer).toBe(base);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    const res = await fetch(`${base}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `${base}/.well-known/oauth-protected-resource/mcp`,
    );
  });

  it("is not served while turned off", async () => {
    settings.remote_mcp_enabled = false;
    expect(
      (await fetch(`${base}/.well-known/oauth-authorization-server`)).status,
    ).toBe(404);
  });

  it("rejects redirects a page could abuse", async () => {
    const res = await fetch(`${base}/oauth/register`, {
      method: "POST",
      body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a wrong PKCE verifier", async () => {
    const clientId = await register();
    const challenge = crypto
      .createHash("sha256")
      .update("a".repeat(43))
      .digest("base64url");
    const html = await (
      await fetch(
        `${base}/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256`,
      )
    ).text();
    decideMcpRequest(mcpRequestViews()[0].requestId, true, "admin");
    const waitUrl = /url=([^"]+)"/.exec(html)![1].replaceAll("&#38;", "&");
    const code = new URL(
      (await fetch(waitUrl, { redirect: "manual" })).headers.get("location")!,
    ).searchParams.get("code")!;
    const res = await fetch(`${base}/oauth/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirect,
        code_verifier: "b".repeat(43),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("gives a read-only client only the read tools", async () => {
    const { access_token } = await signIn("monitor");
    const client = await connect(access_token);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(["list_projects"]);
    await client.close();
  });

  it("keeps a supervised client's agents in the default permission mode", async () => {
    const { access_token } = await signIn("control");
    const client = await connect(access_token);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
      "list_projects",
      "spawn_agent",
    ]);
    await client.callTool({
      name: "spawn_agent",
      arguments: { project_path: "/repo" },
    });
    expect(spawned).toHaveBeenCalledWith(
      expect.objectContaining({ permission_mode: "default" }),
    );
    const bypass = await client.callTool({
      name: "spawn_agent",
      arguments: {
        project_path: "/repo",
        permission_mode: "bypassPermissions",
      },
    });
    expect(bypass.isError).toBe(true);
    const elsewhere = await client.callTool({
      name: "spawn_agent",
      arguments: { project_path: "/somewhere/else" },
    });
    expect(elsewhere.isError).toBe(true);
    expect(spawned).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it("never exposes the user's integrations, even at full access", async () => {
    const { access_token } = await signIn("admin");
    const client = await connect(access_token);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("merge_session");
    expect(names).not.toContain("linear_get_issue");
    await client.close();
  });

  it("rotates refresh tokens and stops working once revoked", async () => {
    const { access_token, refresh_token, clientId, token } =
      await signIn("monitor");
    const refreshed = (await (
      await token({
        grant_type: "refresh_token",
        refresh_token,
        client_id: clientId,
      })
    ).json()) as { access_token: string };
    expect(refreshed.access_token).toBeTruthy();
    // The old refresh token was rotated away.
    expect(
      (
        await token({
          grant_type: "refresh_token",
          refresh_token,
          client_id: clientId,
        })
      ).status,
    ).toBe(400);

    const [grant] = mcpGrantViews();
    revokeMcpGrant(grant.grantId);
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${access_token}` },
    });
    expect(res.status).toBe(401);
  });

  it("denies when the user says no", async () => {
    const clientId = await register();
    const html = await (
      await fetch(
        `${base}/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256&state=s`,
      )
    ).text();
    decideMcpRequest(mcpRequestViews()[0].requestId, false, "monitor");
    const waitUrl = /url=([^"]+)"/.exec(html)![1].replaceAll("&#38;", "&");
    const location = new URL(
      (await fetch(waitUrl, { redirect: "manual" })).headers.get("location")!,
    );
    expect(location.searchParams.get("error")).toBe("access_denied");
  });

  it("refuses cross-origin browser requests", async () => {
    const res = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});
