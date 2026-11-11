import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nodeHostPlatform,
  resetHostPlatform,
  setHostPlatform,
} from "../../../platform";
import { NO_CAPS } from "../../simulator/deviceSource";
import {
  deviceCapabilities,
  resolveDeviceSource,
} from "../../simulator/deviceSources";
import { localDeviceSource } from "../../simulator/machineSource";
import { listAllSimulators } from "../../simulator/simulatorList";
import { loadDeviceHosts, saveDeviceHosts } from "../config";
import {
  type EasHostConfig,
  loadEasHosts,
  normalizeEasHostInput,
} from "./config";
import { EasError, resolveExpoCredential, scrub } from "./credential";
import { makeExpoApi } from "./expoApi";
import { APP_ID, type FakeExpo, fakeExpo } from "./fakeExpo.testkit";
import { EasHost } from "./host";
import { setEasNetworkForTests } from "./http";
import { easDeviceId } from "./ids";
import { readLedger, updateLedger } from "./ledger";
import {
  addEasDeviceHost,
  checkEasAccount,
  initEasDeviceHosts,
  listEasDeviceHosts,
  removeEasDeviceHost,
  resetEasDeviceHostsForTests,
  startEasSession,
  stopEasDeviceHosts,
  updateEasDeviceHost,
} from "./registry";
import { readEasToken } from "./tokens";

const captured: { event: string; props: unknown }[] = [];
vi.mock("../../telemetry/telemetry", () => ({
  capture: (event: string, props: unknown) => captured.push({ event, props }),
}));

const SECRET = "expo-secret-token-abcdef";

let home: string;
let expo: FakeExpo;
let preview: http.Server;
const savedEnv = { ...process.env };

/** The preview host's `/api`: names the simulator's UDID. */
async function startPreview(): Promise<string> {
  preview = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${expo.token}`) {
      res.writeHead(401).end();

      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ device: "SIM-UDID" }));
  });
  await new Promise<void>((r) => preview.listen(0, "127.0.0.1", r));

  return `http://127.0.0.1:${String((preview.address() as AddressInfo).port)}`;
}

function sealedPlatform(available = true) {
  return nodeHostPlatform({
    secretStorage: {
      isAvailable: () => available,
      encrypt: (p) => Buffer.from(`sealed:${Buffer.from(p).toString("hex")}`),
      decrypt: (b) =>
        Buffer.from(b.toString().replace(/^sealed:/, ""), "hex").toString(),
    },
  });
}

function hostConfig(over: Partial<EasHostConfig> = {}): EasHostConfig {
  return {
    id: "eh0a1b2c3d",
    ...normalizeEasHostInput({ label: "Cloud", appId: APP_ID }),
    ...over,
  };
}

function newHost(over: Parameters<typeof hostConfig>[0] = {}) {
  return new EasHost(hostConfig(over), {
    savedToken: () => "",
    pollMs: 1,
  });
}

describe("eas simulator hosts", () => {
  // A temp home, a fake Expo and a fake preview host for every test.
  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-eas-"));
    process.env.ARGUS_HOME = home;
    // Never let a test reach the real `eas login` session or EXPO_TOKEN.
    process.env.HOME = home;
    process.env.EXPO_TOKEN = SECRET;
    setHostPlatform(sealedPlatform());
    expo = fakeExpo({ fallback: fetch });
    expo.previewUrl = await startPreview();
    setEasNetworkForTests({ fetch: expo.fetch });
    captured.length = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetEasDeviceHostsForTests();
    setEasNetworkForTests(null);
    resetHostPlatform();
    process.env = { ...savedEnv };
    await new Promise((r) => preview.close(r));
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe("eas host config", () => {
    it("defaults and bounds the limits like EAS does", () => {
      const c = normalizeEasHostInput({});
      expect(c).toMatchObject({
        label: "EAS Simulator",
        appId: null,
        maxSessionMinutes: 30,
        idleMinutes: 10,
        maxConcurrentSessions: 2,
      });
      expect(() => normalizeEasHostInput({ maxSessionMinutes: 116 })).toThrow(
        /1 to 115/,
      );
      expect(() => normalizeEasHostInput({ idleMinutes: 0 })).toThrow(
        /1 to 60/,
      );
      expect(() =>
        normalizeEasHostInput({ maxConcurrentSessions: 21 }),
      ).toThrow(/1 to 20/);
      expect(() =>
        normalizeEasHostInput({ maxSessionMinutes: 10, idleMinutes: 10 }),
      ).toThrow("Idle minutes must be smaller than session minutes.");
      expect(() => normalizeEasHostInput({ appId: "not-a-uuid" })).toThrow(
        /UUID/,
      );
    });

    it("keeps EAS hosts apart from SSH hosts in the same file", () => {
      saveDeviceHosts([
        {
          id: "rh0a1b2c3d",
          target: "studio",
          port: null,
          identityFile: null,
          label: "studio",
        },
      ]);
      addEasDeviceHost({ label: "Cloud", appId: APP_ID });
      const raw = JSON.parse(
        fs.readFileSync(path.join(home, "device-hosts.json"), "utf8"),
      ) as { hosts: unknown[]; easHosts: unknown[]; version: number };
      expect(raw.version).toBe(1);
      expect(raw.hosts).toHaveLength(1);
      expect(raw.easHosts).toHaveLength(1);
      // An SSH-only reader still parses it, and saving SSH hosts keeps EAS ones.
      expect(loadDeviceHosts()).toHaveLength(1);
      saveDeviceHosts([]);
      expect(loadEasHosts()).toHaveLength(1);
    });
  });

  describe("expo credentials", () => {
    it("prefers the saved token, then EXPO_TOKEN, then the eas login session", () => {
      const where = { env: { EXPO_TOKEN: "from-env" }, home };
      expect(resolveExpoCredential(" saved ", where)).toMatchObject({
        source: "settings",
        header: { name: "authorization", value: "Bearer saved" },
      });
      expect(resolveExpoCredential("", where).source).toBe("env");
      fs.mkdirSync(path.join(home, ".expo"));
      fs.writeFileSync(
        path.join(home, ".expo", "state.json"),
        JSON.stringify({ auth: { sessionSecret: "session-secret" } }),
      );
      expect(resolveExpoCredential("", { env: {}, home })).toMatchObject({
        source: "eas-login",
        header: { name: "expo-session", value: "session-secret" },
      });
      fs.rmSync(path.join(home, ".expo"), { recursive: true });
      expect(() => resolveExpoCredential("", { env: {}, home })).toThrow(
        /No Expo credential/,
      );
      expect(() => resolveExpoCredential("bad\ntoken", where)).toThrow(
        /not a usable Expo credential/,
      );
    });

    it("never lets the credential through in an error", async () => {
      expo.failNext.set("ArgusExpoViewer", "echo");
      const api = makeExpoApi(
        resolveExpoCredential("", { env: { EXPO_TOKEN: SECRET }, home }),
      );
      const err = (await api.viewer().catch((e: unknown) => e)) as EasError;
      expect(err).toBeInstanceOf(EasError);
      expect(err.message).toContain("[redacted]");
      expect(err.message).not.toContain(SECRET);
      expect(scrub(`x ${SECRET} y`, SECRET)).toBe("x [redacted] y");
    });

    it("seals saved tokens and refuses without secure storage", () => {
      const host = addEasDeviceHost({
        label: "Cloud",
        token: "saved-token-xyz",
      });
      const file = fs.readFileSync(path.join(home, "eas-tokens.json"), "utf8");
      expect(file).not.toContain("saved-token-xyz");
      expect(readEasToken(host.id)).toBe("saved-token-xyz");
      expect(listEasDeviceHosts()[0].hasToken).toBe(true);
      expect(JSON.stringify(listEasDeviceHosts())).not.toContain(
        "saved-token-xyz",
      );
      setHostPlatform(sealedPlatform(false));
      expect(() =>
        updateEasDeviceHost({ id: host.id, token: "another" }),
      ).toThrow(/no secure storage/);
    });
  });

  describe("eas host sessions", () => {
    it("starts a bounded session, records it first, and stops it on close", async () => {
      const host = newHost({ maxSessionMinutes: 40, idleMinutes: 5 });
      expect(host.listDevices().map((d) => [d.udid, d.booted])).toEqual([
        [easDeviceId(host.id, 1), false],
      ]);
      await host.open(1);
      const [session] = expo.sessions.values();
      expect(session).toMatchObject({
        appId: APP_ID,
        maxRunTimeMinutes: 40,
        maxIdleTimeMinutes: 5,
        status: "IN_PROGRESS",
      });
      // Recorded before the create went out.
      const ops = expo.requests.map((r) => r.operation);
      expect(ops.indexOf("ArgusCreateEasSimulatorSession")).toBeGreaterThan(-1);
      expect(readLedger(host.id).map((e) => e.name)).toEqual([session.name]);
      expect(host.endpoint(1)).toEqual({
        origin: expo.previewUrl,
        token: expo.token,
        udid: "SIM-UDID",
      });
      expect(host.listDevices().map((d) => [d.udid, d.booted])).toEqual([
        [easDeviceId(host.id, 1), true],
        [easDeviceId(host.id, 2), false],
      ]);

      await host.close(1);
      expect(session.status).toBe("STOPPED");
      expect(readLedger(host.id)).toEqual([]);
      expect(host.endpoint(1)).toBeNull();
      expect(captured.map((c) => c.event)).toEqual([
        "eas_session_started",
        "eas_session_ended",
      ]);
    });

    it("refuses to start past the concurrent limit", async () => {
      const host = newHost({ maxConcurrentSessions: 1 });
      await host.open(1);
      expect(host.listDevices()).toHaveLength(1);
      await expect(host.open(2)).rejects.toThrow(
        "Cloud is limited to 1 running session. Close one first",
      );
      expect(expo.sessions.size).toBe(1);
    });

    it("counts a create with an unknown outcome against the limit", async () => {
      const host = newHost({ maxConcurrentSessions: 1 });
      expo.failNext.set("ArgusCreateEasSimulatorSession", "server");
      await expect(host.open(1)).rejects.toThrow(/Expo could not start/);
      await expect(host.open(1)).rejects.toThrow(/still being cleaned up/);
      // A refused create made nothing: its slot frees.
      const other = newHost({ id: "eh11111111", maxConcurrentSessions: 1 });
      expo.failNext.set("ArgusCreateEasSimulatorSession", "refused");
      await expect(other.open(1)).rejects.toThrow(/refused/);
      expect(readLedger(other.id)[0].refused).toBe(true);
      await other.open(1);
    });

    it("explains how to sign in before anything else", async () => {
      delete process.env.EXPO_TOKEN;
      const host = newHost();
      await expect(host.open(1)).rejects.toThrow(/No Expo credential/);
      expect(expo.requests).toEqual([]);
    });

    it("refuses when EAS Simulator isn't enabled for the account", async () => {
      expo.enabled = false;
      await expect(newHost().open(1)).rejects.toThrow(/not enabled/);
      expect(expo.sessions.size).toBe(0);
    });

    it("stops a session it was cancelled during the start of", async () => {
      expo.startPolls = 1_000;
      const host = newHost();
      const opening = host.open(1);
      await vi.waitFor(() => expect(expo.sessions.size).toBe(1));
      await host.close(1);
      await expect(opening).rejects.toThrow(
        /stopped while the session started/,
      );
      expect([...expo.sessions.values()][0].status).toBe("STOPPED");
      expect(host.listDevices().every((d) => !d.booted)).toBe(true);
    });

    it("uses the account's only project when none is set", async () => {
      const host = newHost({ appId: null });
      await host.open(1);
      expect([...expo.sessions.values()][0].appId).toBe(APP_ID);
      expo.apps.push({
        id: "11111111-1111-4111-8111-111111111111",
        fullName: "@me/b",
      });
      await expect(
        newHost({ id: "eh22222222", appId: null }).open(1),
      ).rejects.toThrow(/Choose the EAS project/);
    });

    it("drops a session Expo ended at its limit", async () => {
      let now = 1_000_000;
      const host = new EasHost(hostConfig(), {
        savedToken: () => "",
        pollMs: 1,
        now: () => now,
      });
      await host.open(1);
      [...expo.sessions.values()][0].status = "STOPPED";
      now += 60_000;
      await host.maintain();
      expect(host.runningSessions()).toBe(0);
      expect(readLedger(host.id)).toEqual([]);
      expect(captured.at(-1)).toEqual({
        event: "eas_session_ended",
        props: { reason: "expired", duration_bucket: "<10m" },
      });
    });
  });

  describe("leftover sessions", () => {
    it("stops what a dead process recorded and never touches foreign sessions", async () => {
      addEasDeviceHost({ label: "Cloud", appId: APP_ID });
      const [{ id }] = listEasDeviceHosts();
      // A previous process recorded and started one; another tool runs its own.
      updateLedger(id, () => [
        {
          name: "Argus · Cloud · abc123",
          appId: APP_ID,
          recordedAt: Date.now(),
        },
      ]);
      expo.sessions.set("ours", {
        id: "ours",
        name: "Argus · Cloud · abc123",
        appId: APP_ID,
        status: "IN_PROGRESS",
      });
      expo.sessions.set("theirs", {
        id: "theirs",
        name: "Someone else",
        appId: APP_ID,
        status: "IN_PROGRESS",
      });
      resetEasDeviceHostsForTests();

      initEasDeviceHosts();
      await vi.waitFor(() =>
        expect(expo.sessions.get("ours")?.status).toBe("STOPPED"),
      );
      expect(expo.sessions.get("theirs")?.status).toBe("IN_PROGRESS");
      expect(expo.stopped).toEqual(["ours"]);
      await vi.waitFor(() => expect(readLedger(id)).toEqual([]));
    });

    it("holds the slot for a fresh record until a sweep settles it", () => {
      const host = newHost({ maxConcurrentSessions: 1 });
      updateLedger(host.id, () => [
        {
          name: "Argus · Cloud · fff000",
          appId: APP_ID,
          recordedAt: Date.now(),
        },
      ]);
      host.adoptRecorded();
      expect(host.nextSlot()).toBeNull();
    });
  });

  describe("eas device hosts through the device source seam", () => {
    it("lists, opens and closes slots via the registry without caller changes", async () => {
      initEasDeviceHosts();
      const host = addEasDeviceHost({ label: "Cloud", appId: APP_ID });
      const id = easDeviceId(host.id, 1);
      // A cold `simctl list` on CI outlasts the test timeout; this test is about EAS.
      vi.spyOn(localDeviceSource, "list").mockResolvedValue([]);
      const all = await listAllSimulators();
      expect(all.find((d) => d.udid === id)).toMatchObject({
        booted: false,
        deviceHostId: host.id,
        deviceHostLabel: "Cloud",
      });
      expect(deviceCapabilities(id)).toEqual(NO_CAPS);
      const source = resolveDeviceSource(id);
      await source.open(id);
      expect((await source.find(id))?.booted).toBe(true);
      await source.close(id);
      expect([...expo.sessions.values()][0].status).toBe("STOPPED");
    });

    it("starts from the phone path and stops everything when the host is removed", async () => {
      initEasDeviceHosts();
      const host = addEasDeviceHost({ label: "Cloud", appId: APP_ID });
      const deviceId = await startEasSession(host.id, { wait: true });
      expect(deviceId).toBe(easDeviceId(host.id, 1));
      // The phone doesn't wait: the slot is taken while it starts.
      await expect(startEasSession(host.id)).resolves.toBe(
        easDeviceId(host.id, 2),
      );
      await expect(startEasSession(host.id)).rejects.toMatch(/session limit/);
      await removeEasDeviceHost(host.id);
      expect([...expo.sessions.values()].map((s) => s.status)).toEqual([
        "STOPPED",
        "STOPPED",
      ]);
      expect(listEasDeviceHosts()).toEqual([]);
      expect(() => resolveDeviceSource(deviceId)).toThrow(/was removed/);
      expect(
        fs.existsSync(path.join(home, "eas-sessions", `${host.id}.json`)),
      ).toBe(false);
    });

    it("stops every session at shutdown", async () => {
      initEasDeviceHosts();
      const host = addEasDeviceHost({ label: "Cloud", appId: APP_ID });
      await startEasSession(host.id, { wait: true });
      await stopEasDeviceHosts();
      expect([...expo.sessions.values()][0].status).toBe("STOPPED");
    });

    it("checks the account without leaking Expo's text or the token", async () => {
      await expect(checkEasAccount({})).resolves.toEqual({
        signedInAs: "me",
        credentialSource: "env",
        apps: expo.apps,
      });
      expo.failNext.set("ArgusExpoViewer", "unauthorized");
      await expect(checkEasAccount({ token: "draft-token" })).rejects.toBe(
        "Expo rejected the credential (HTTP 401).",
      );
      expo.failNext.set("ArgusExpoViewer", "echo");
      const err = await checkEasAccount({}).catch((e: unknown) => String(e));
      expect(err).not.toContain(SECRET);
      expect(captured.map((c) => c.props)).toContainEqual({
        success: true,
        credential_source: "env",
        failure: "none",
      });
    });
  });
});
