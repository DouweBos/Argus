import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forceStopSimulatorCapture,
  listAllSimulators,
  simulatorTouch,
  startSimulatorCapture,
} from "../simulator/ios";
import { localDeviceSource } from "../simulator/machineSource";
import { normalizeDeviceHostInput } from "./config";
import { isRemoteDeviceId, parseDeviceId, remoteDeviceId } from "./deviceId";
import { localMachine } from "./machine";
import {
  addDeviceHost,
  interpretProbe,
  listDeviceHosts,
  machineForDevice,
  onDeviceHostRemoved,
  removeDeviceHost,
  resetDeviceHostsForTests,
  testDeviceHost,
} from "./registry";
import {
  ProcessStream,
  classifySshFailure,
  setSshSpawnForTests,
  shellQuote,
  sshExecArgs,
  sshMasterArgs,
  sshStreamArgs,
} from "./ssh";

const HOST = {
  id: "rh0a1b2c3d",
  target: "studio",
  port: null,
  identityFile: null,
  label: "studio",
};

describe("normalizeDeviceHostInput", () => {
  it("accepts an alias, user@host, a port and a ~ identity", () => {
    expect(normalizeDeviceHostInput({ target: " studio " })).toEqual({
      target: "studio",
      port: null,
      identityFile: null,
      label: "studio",
    });
    const full = normalizeDeviceHostInput({
      target: "ci@mac-mini.local",
      port: 2222,
      identityFile: "~/.ssh/id_ed25519",
    });
    expect(full.label).toBe("mac-mini.local");
    expect(full.port).toBe(2222);
    expect(full.identityFile).toBe(path.join(os.homedir(), ".ssh/id_ed25519"));
  });

  it.each([
    "",
    "-oProxyCommand=touch /tmp/x",
    "studio; rm -rf ~",
    "user@host name",
    "$(whoami)@host",
    "host`id`",
  ])("rejects the target %j", (target) => {
    expect(() => normalizeDeviceHostInput({ target })).toThrow();
  });

  it("rejects bad ports and relative identity files", () => {
    expect(() => normalizeDeviceHostInput({ target: "a", port: 0 })).toThrow();
    expect(() =>
      normalizeDeviceHostInput({ target: "a", port: 70000 }),
    ).toThrow();
    expect(() =>
      normalizeDeviceHostInput({ target: "a", port: 22.5 }),
    ).toThrow();
    expect(() =>
      normalizeDeviceHostInput({ target: "a", identityFile: "id_rsa" }),
    ).toThrow();
  });
});

describe("device ids", () => {
  it("namespaces remote UDIDs and leaves local ones alone", () => {
    const udid = "1F2E3D4C-0000-4000-8000-ABCDEFABCDEF";
    const id = remoteDeviceId(HOST.id, udid);
    expect(parseDeviceId(id)).toEqual({ hostId: HOST.id, udid });
    expect(parseDeviceId(udid)).toEqual({ hostId: null, udid });
    expect(isRemoteDeviceId(id)).toBe(true);
    expect(isRemoteDeviceId(udid)).toBe(false);
  });

  it("doesn't mistake a stray tilde for a host", () => {
    expect(parseDeviceId("emulator~5554").hostId).toBeNull();
    expect(parseDeviceId(`${HOST.id}~`).hostId).toBeNull();
  });
});

describe("ssh argv", () => {
  it("quotes remote words for the shell", () => {
    expect(shellQuote("simctl")).toBe("simctl");
    expect(shellQuote("/Users/a b/x")).toBe("'/Users/a b/x'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("$(id)")).toBe("'$(id)'");
  });

  it("runs commands non-interactively with host keys checked", () => {
    const args = sshExecArgs(
      { ...HOST, port: 2222, identityFile: "/k/id" },
      "xcrun",
      ["simctl", "spawn", "UDID", "/Users/a b/tool"],
    );
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("StrictHostKeyChecking=accept-new");
    expect(args).toContain("ControlMaster=no");
    expect(args.slice(args.indexOf("-p"), args.indexOf("-p") + 2)).toEqual([
      "-p",
      "2222",
    ]);
    expect(args.slice(-3)).toEqual([
      "--",
      "studio",
      "xcrun simctl spawn UDID '/Users/a b/tool'",
    ]);
  });

  it("streams to the remote loopback only", () => {
    const args = sshStreamArgs(HOST, 5123);
    const w = args.indexOf("-W");
    expect(args[w + 1]).toBe("127.0.0.1:5123");
    expect(w).toBeLessThan(args.indexOf("--"));
    expect(args.at(-1)).toBe("studio");
  });

  it("runs the master in the foreground so Argus owns it", () => {
    const args = sshMasterArgs(HOST);
    expect(args).toContain("ControlMaster=yes");
    expect(args).toContain("ControlPersist=no");
    expect(args).toContain("-N");
  });

  it("sorts ssh failures", () => {
    expect(classifySshFailure("user@x: Permission denied (publickey).")).toBe(
      "auth",
    );
    expect(classifySshFailure("Host key verification failed.")).toBe(
      "host_key",
    );
    expect(
      classifySshFailure("ssh: Could not resolve hostname nope: nodename"),
    ).toBe("unreachable");
    expect(
      classifySshFailure("ssh: connect to host x port 22: Operation timed out"),
    ).toBe("timeout");
  });
});

describe("interpretProbe", () => {
  it("accepts an Apple silicon Mac with simctl", () => {
    const r = interpretProbe("Darwin\narm64\n15.5\nsimctl-ok\n");
    expect(r).toMatchObject({ ok: true, macosVersion: "15.5", arch: "arm64" });
  });

  it.each([
    ["Linux\nx86_64\n-\nsimctl-missing\n", "not_macos"],
    ["Darwin\nx86_64\n14.0\nsimctl-ok\n", "unsupported_arch"],
    ["Darwin\narm64\n15.0\nsimctl-missing\n", "no_xcode"],
  ])("rejects %j as %s", (out, failure) => {
    expect(interpretProbe(out)).toMatchObject({ ok: false, failure });
  });
});

// --- A fake ssh -------------------------------------------------------------

type Reply = "hang" | { code: number; stderr?: string; stdout?: string };

function fakeChild(reply: Reply): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, {
    stdout,
    stderr,
    stdin: new PassThrough(),
    exitCode: null,
    kill: () => {
      setImmediate(() => child.emit("close", null));

      return true;
    },
  });
  if (reply !== "hang") {
    setImmediate(() => {
      stdout.end(reply.stdout ?? "");
      stderr.end(reply.stderr ?? "");
      Object.assign(child, { exitCode: reply.code });
      child.emit("close", reply.code);
    });
  }

  return child;
}

describe("processStream", () => {
  it("reads the process's stdout and kills it when destroyed", async () => {
    const child = fakeChild("hang");
    let killed = false;
    child.kill = () => {
      killed = true;

      return true;
    };
    const stream = new ProcessStream(child);
    const got = new Promise<string>((resolve) =>
      stream.once("data", (c: Buffer) => resolve(c.toString())),
    );
    (child.stdout as PassThrough).write("h264");
    await expect(got).resolves.toBe("h264");
    stream.destroy();
    expect(killed).toBe(true);
  });
});

const SIMCTL_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
      {
        udid: "REMOTE-UDID",
        name: "iPhone 16",
        state: "Booted",
        isAvailable: true,
      },
    ],
  },
});

describe("device host registry", () => {
  let home: string;
  let calls: string[][];
  let respond: (args: string[]) => Reply;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "dh-"));
    process.env.ARGUS_HOME = home;
    calls = [];
    respond = () => ({ code: 0 });
    // Remote listings are under test; a cold local `simctl list` can outlast the timeout.
    vi.spyOn(localDeviceSource, "list").mockResolvedValue([]);
    setSshSpawnForTests((_file, args) => {
      calls.push(args);

      return fakeChild(args.includes("-N") ? "hang" : respond(args));
    });
    resetDeviceHostsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDeviceHostsForTests();
    setSshSpawnForTests(null);
    delete process.env.ARGUS_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("persists hosts privately and refuses duplicates", () => {
    const host = addDeviceHost({ target: "studio", label: "Studio" });
    expect(host.id).toMatch(/^rh[0-9a-f]{8}$/);
    const file = path.join(home, "device-hosts.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(() => addDeviceHost({ target: "studio" })).toThrow();

    resetDeviceHostsForTests();
    expect(listDeviceHosts().map((h) => h.label)).toEqual(["Studio"]);
  });

  it("routes local ids locally and remote ids to their host", () => {
    const host = addDeviceHost({ target: "studio" });
    expect(machineForDevice("LOCAL-UDID")).toEqual({
      machine: localMachine,
      udid: "LOCAL-UDID",
    });
    const remote = machineForDevice(remoteDeviceId(host.id, "R"));
    expect(remote.udid).toBe("R");
    expect(remote.machine.hostId).toBe(host.id);
    expect(() => machineForDevice(remoteDeviceId("rhffffffff", "R"))).toThrow();
  });

  it("lists a host's simulators namespaced and labelled", async () => {
    const host = addDeviceHost({ target: "studio", label: "Studio" });
    respond = (args) =>
      args.at(-1) === "xcrun simctl list devices --json"
        ? { code: 0, stdout: SIMCTL_JSON }
        : { code: 1 };

    const remote = (await listAllSimulators()).filter((d) => d.deviceHostId);
    expect(remote).toEqual([
      expect.objectContaining({
        udid: `${host.id}~REMOTE-UDID`,
        deviceHostLabel: "Studio",
        booted: true,
      }),
    ]);
    expect(listDeviceHosts()[0].status).toBe("connected");
  });

  it("backs off a host that fails instead of asking on every poll", async () => {
    addDeviceHost({ target: "studio" });
    respond = () => ({
      code: 255,
      stderr: "ssh: connect to host studio port 22: Connection refused",
    });

    await listAllSimulators();
    const [status] = listDeviceHosts();
    expect(status.status).toBe("unreachable");
    expect(status.error).toMatch(/reach/);

    const before = calls.length;
    await listAllSimulators();
    expect(calls).toHaveLength(before);
  });

  it("stops a removed host's helpers and forgets it", () => {
    const host = addDeviceHost({ target: "studio" });
    const removed: string[] = [];
    const off = onDeviceHostRemoved((id) => removed.push(id));
    removeDeviceHost(host.id);
    off();
    expect(removed).toEqual([host.id]);
    expect(listDeviceHosts()).toEqual([]);
    expect(() => removeDeviceHost(host.id)).toThrow();
  });

  it("tests a draft without installing anything", async () => {
    respond = () => ({
      code: 255,
      stderr: "git@studio: Permission denied (publickey).",
    });
    const failed = await testDeviceHost({ target: "studio" });
    expect(failed).toMatchObject({ ok: false, failure: "auth" });

    respond = () => ({ code: 0, stdout: "Darwin\narm64\n15.5\nsimctl-ok\n" });
    await expect(testDeviceHost({ target: "studio" })).resolves.toMatchObject({
      ok: true,
    });
    // One probe per test, and no upload (`cat >`) anywhere.
    expect(calls.flat().some((a) => a.includes("cat >"))).toBe(false);

    await expect(testDeviceHost({ target: "-oops" })).resolves.toMatchObject({
      ok: false,
      failure: "invalid_config",
    });
  });

  it("captures a remote simulator through ssh end to end", async () => {
    const host = addDeviceHost({ target: "studio" });
    const id = remoteDeviceId(host.id, "REMOTE-UDID");
    const bridgeCmds: Record<string, unknown>[] = [];
    let uploads = 0;
    setSshSpawnForTests((_file, args) => {
      calls.push(args);
      const cmd = args.at(-1) ?? "";
      if (args.includes("-N") || args.includes("-W")) {
        return fakeChild("hang");
      }
      if (cmd.startsWith("/") && cmd.endsWith("/argus-sim-bridge")) {
        // The bridge: answer each JSON line on stdin.
        const child = fakeChild("hang");
        child.stdin.on("data", (chunk: Buffer) => {
          for (const line of chunk.toString().trim().split("\n")) {
            bridgeCmds.push(JSON.parse(line) as Record<string, unknown>);
            (child.stdout as PassThrough).write(
              `${JSON.stringify({ ok: true, port: 5123 })}\n`,
            );
          }
        });

        return child;
      }
      if (cmd === "xcrun simctl list devices --json") {
        return fakeChild({ code: 0, stdout: SIMCTL_JSON });
      }
      if (cmd === 'printf %s "$HOME"') {
        return fakeChild({ code: 0, stdout: "/Users/remote" });
      }
      if (cmd.startsWith("test -x")) {
        return fakeChild({ code: 1 });
      }
      if (cmd.includes("cat >")) {
        uploads += 1;
      }

      return fakeChild({ code: 0 });
    });

    await expect(startSimulatorCapture(id)).resolves.toBe(5123);
    // The bridge was uploaded once, pinned under the remote's ~/.argus.
    expect(uploads).toBe(1);
    const spawned = calls.find((a) => a.at(-1)?.startsWith("/"));
    expect(spawned?.at(-1)).toMatch(
      /^\/Users\/remote\/\.argus\/remote-bin\/[0-9a-f]{12}\/argus-sim-bridge$/,
    );
    // The stream came back over `ssh -W` to the remote loopback.
    expect(calls.some((a) => a.includes("127.0.0.1:5123"))).toBe(true);

    await simulatorTouch(id, 0.5, 0.5, 0);
    // The bridge only ever sees the host-local UDID.
    const addressed = bridgeCmds.filter((c) => c.cmd !== "display_info");
    expect(addressed.map((c) => [c.cmd, c.udid])).toEqual([
      ["start_capture", "REMOTE-UDID"],
      ["touch", "REMOTE-UDID"],
    ]);

    forceStopSimulatorCapture(id);
  });
});
