/**
 * The managed tunnel on a linked host: credentials come from the account
 * service for this host only, the connector runs with them while remote access
 * is on, its address is published, refused credentials are fetched again, and
 * unlinking gives the tunnel back.
 */

import type { LogEntry } from "@argus/remote-protocol";
import {
  generateSigningKey,
  makeEntry,
  verifyLog,
} from "@argus/remote-protocol";
import { x25519 } from "@noble/curves/ed25519.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nodeHostPlatform,
  resetHostPlatform,
  setHostPlatform,
} from "../../platform";
import { FakeAccountService } from "./fakeAccountService";

const PHONE_ID = "00000000-0000-4000-8000-0000000000b1";

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("account managed tunnel", () => {
  let home: string;
  let log: string;
  let fake: FakeAccountService;
  const prev = {
    home: process.env.ARGUS_HOME,
    url: process.env.ARGUS_ACCOUNT_URL,
    bin: process.env.ARGUS_CLOUDFLARED_PATH,
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-account-tunnel-"));
    log = path.join(home, "launches.log");
    const bin = path.join(home, "cloudflared");
    // Tokens starting with "bad" are refused at the edge, like a reclaimed tunnel's.
    fs.writeFileSync(
      bin,
      `#!/bin/sh
echo "$TUNNEL_TOKEN" >> "${log}"
case "$TUNNEL_TOKEN" in
  bad*) echo "ERR Unauthorized: Invalid tunnel secret" >&2; exit 1 ;;
esac
echo "INF Registered tunnel connection connIndex=0" >&2
exec sleep 30
`,
      { mode: 0o755 },
    );
    process.env.ARGUS_HOME = home;
    process.env.ARGUS_CLOUDFLARED_PATH = bin;
    fake = new FakeAccountService();
    process.env.ARGUS_ACCOUNT_URL = fake.baseUrl;
    vi.stubGlobal("fetch", fake.fetch);
    vi.resetModules();
    setHostPlatform(nodeHostPlatform());
  });

  afterEach(async () => {
    const { stopAccount } = await import("./service");
    stopAccount();
    vi.unstubAllGlobals();
    process.env.ARGUS_HOME = prev.home;
    process.env.ARGUS_ACCOUNT_URL = prev.url;
    if (prev.bin === undefined) {
      delete process.env.ARGUS_CLOUDFLARED_PATH;
    } else {
      process.env.ARGUS_CLOUDFLARED_PATH = prev.bin;
    }
    resetHostPlatform();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function launches(): string[] {
    return fs.existsSync(log)
      ? fs.readFileSync(log, "utf-8").trim().split("\n").filter(Boolean)
      : [];
  }

  /** A phone's account with this host linked locally. */
  async function linked(): Promise<string> {
    const sign = generateSigningKey();
    const phone = {
      id: PHONE_ID,
      role: "device" as const,
      kind: "ios" as const,
      sign_pub: sign.pub,
      noise_pub: Buffer.from(
        x25519.getPublicKey(x25519.utils.randomSecretKey()),
      ).toString("base64"),
      name: "Phone",
      created_at: 1,
    };
    const write = (
      fields: Record<string, unknown> & { type: string },
    ): LogEntry =>
      makeEntry(
        { account_id: fake.accountId, epoch: 0, head: fake.head() },
        { id: PHONE_ID, priv: sign.priv },
        fields,
      );
    fake.append([write({ type: "genesis", member: phone })]);
    const service = await import("./service");
    await service.startAccount({ disconnect: vi.fn() });
    const offer = await service.linkLocalBegin();
    fake.append([
      write({
        type: "add_host",
        member: offer.host,
        proof: offer.proof,
        request_id: "",
        sas_commit: "",
      }),
    ]);
    await service.linkLocalFinish({
      accountId: fake.accountId,
      epoch: 0,
      genesisHash: verifyLog(fake.entries).state!.genesis_hash,
    });

    return offer.host.id;
  }

  async function gatewayUp(): Promise<void> {
    const endpoints = await import("../remote/endpoints");
    endpoints.setGatewayOnLan(true);
  }

  async function tunnelState() {
    return (await import("../remote/managedTunnel")).getManagedTunnelState();
  }

  it("stays off until the gateway listens", async () => {
    await linked();

    await expect(tunnelState()).resolves.toMatchObject({
      phase: "off",
      reason: "remote_off",
    });
    expect(fake.tunnelRequests).toEqual([]);
  });

  it("asks for this host's tunnel, runs it and publishes its address", async () => {
    const hostId = await linked();
    await gatewayUp();
    const managed = await import("../remote/managedTunnel");
    await until(() => managed.getManagedTunnelState().phase === "running");

    const issued = fake.tunnels.get(hostId)!;
    expect(fake.tunnelRequests).toEqual([hostId]);
    expect(issued.port).toBe(
      (await import("../remote/endpoints")).LOCAL_GATEWAY_PORT,
    );
    expect(launches()).toEqual([issued.token]);
    const url = `wss://${issued.hostname}`;
    expect(managed.getManagedTunnelUrl()).toBe(url);

    const { getEndpoints } = await import("../remote/endpoints");
    expect(getEndpoints().at(-1)).toEqual({
      kind: "cloudflare",
      url,
      priority: 2,
    });
    const { publishPresence } = await import("./presence");
    await publishPresence();
    const body = JSON.parse(fake.presence.get(hostId)!.presence_body) as {
      endpoints: { kind: string; url: string }[];
    };
    expect(body.endpoints).toContainEqual({
      kind: "cloudflare",
      url,
      priority: 2,
    });

    // Kept in the encrypted record: a restart reuses it without asking again.
    const { readAccountRecord } = await import("./store");
    expect((await readAccountRecord())?.tunnel).toMatchObject({
      hostname: issued.hostname,
      token: issued.token,
    });
  });

  it("reuses stored credentials after a restart", async () => {
    await linked();
    await gatewayUp();
    const managed = await import("../remote/managedTunnel");
    await until(() => managed.getManagedTunnelState().phase === "running");
    const { startAccount, stopAccount } = await import("./service");
    stopAccount();

    await startAccount({ disconnect: vi.fn() });
    await until(() => managed.getManagedTunnelState().phase === "running");

    expect(fake.tunnelRequests).toHaveLength(1);
    expect(launches()).toHaveLength(2);
  });

  it("fetches fresh credentials when the edge refuses the stored ones", async () => {
    const hostId = await linked();
    // The tunnel was reclaimed and re-created: the first token is dead.
    fake.tunnelTokens = ["bad-token", "good-token"];
    await gatewayUp();
    const managed = await import("../remote/managedTunnel");

    await until(() => managed.getManagedTunnelState().phase === "running");

    expect(launches()).toEqual(["bad-token", "good-token"]);
    expect(fake.tunnelRequests).toEqual([hostId, hostId]);
  });

  it("falls back cleanly when the service has no tunnels", async () => {
    fake.tunnelsEnabled = false;
    await linked();
    await gatewayUp();

    await until(() => fake.tunnelRequests.length === 1);
    const managed = await import("../remote/managedTunnel");
    await until(() => managed.getManagedTunnelState().phase === "unavailable");

    expect(launches()).toEqual([]);
    const { getEndpoints } = await import("../remote/endpoints");
    expect(getEndpoints().some((e) => e.kind === "cloudflare")).toBe(false);
  });

  it("turns off with the account setting and back on", async () => {
    await linked();
    await gatewayUp();
    const managed = await import("../remote/managedTunnel");
    await until(() => managed.getManagedTunnelState().phase === "running");
    const { setAccountConfig } = await import("./service");

    const status = await setAccountConfig({ tunnel: false });

    expect(status.config.tunnel).toBe(false);
    expect(managed.getManagedTunnelState()).toMatchObject({
      phase: "off",
      reason: "turned_off",
    });
    expect(managed.runningToken()).toBeNull();

    await setAccountConfig({ tunnel: true });
    await until(() => managed.getManagedTunnelState().phase === "running");
  });

  it("gives the tunnel back on unlink", async () => {
    const hostId = await linked();
    await gatewayUp();
    const managed = await import("../remote/managedTunnel");
    await until(() => managed.getManagedTunnelState().phase === "running");
    const { logout } = await import("./service");

    await logout();

    expect(fake.tunnelReleases).toEqual([hostId]);
    expect(managed.getManagedTunnelState()).toMatchObject({
      phase: "off",
      reason: "not_linked",
    });
    expect(managed.runningToken()).toBeNull();
  });
});
