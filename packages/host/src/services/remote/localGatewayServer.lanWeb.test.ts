import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeypair } from "./noise";

const directLan = vi.hoisted(() => ({ value: false }));
vi.mock("./endpoints", () => ({
  isDirectLanPeer: () => directLan.value,
}));
vi.mock("@argus/host/bus", () => ({
  addHostEventSink: () => () => {},
  emitHostEvent: () => {},
}));
vi.mock("./deviceStore", () => ({
  findDeviceByStaticKey: async () => null,
  updateLastSeen: vi.fn(async () => {}),
}));

const { startLocalGateway, stopLocalGateway } =
  await import("./localGatewayServer");

let identity: ReturnType<typeof generateKeypair>;
let staticDir: string;

async function load(lanWebClient: boolean): Promise<Response> {
  const port = await startLocalGateway(0, identity, {
    host: "127.0.0.1",
    staticDir,
    lanWebClient: () => lanWebClient,
  });

  return fetch(`http://127.0.0.1:${port}/`);
}

describe("serving the web client to the local network", () => {
  beforeAll(() => {
    identity = generateKeypair();
    staticDir = mkdtempSync(path.join(tmpdir(), "argus-web-"));
    writeFileSync(path.join(staticDir, "index.html"), "<p>web client</p>");
  });

  afterEach(() => {
    stopLocalGateway();
    directLan.value = false;
  });

  it("serves it over a tunnel or the tailnet regardless of the setting", async () => {
    const res = await load(false);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain("web client");
  });

  it("refuses a direct local-network browser while the setting is off", async () => {
    directLan.value = true;
    const res = await load(false);
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain("web client</p>");
    expect(body).not.toContain("<script");
  });

  it("serves a direct local-network browser once the user opts in", async () => {
    directLan.value = true;
    const res = await load(true);
    expect(res.status).toBe(200);
  });
});
