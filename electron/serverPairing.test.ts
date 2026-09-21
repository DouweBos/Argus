/**
 * Tray pairing is the packaged server's only way to accept a first device, so
 * the state machine and the grant choice are worth pinning down — especially
 * that "view only" cannot hand out admin.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const clipboardText: string[] = [];
vi.mock("electron", () => ({
  clipboard: { writeText: (t: string) => clipboardText.push(t) },
}));

const written = new Map<string, string>();
vi.mock("node:fs", () => ({
  default: {
    writeFileSync: (p: string, data: string) => written.set(p, data),
    rmSync: (p: string) => {
      written.delete(p);
    },
  },
}));

vi.mock("@argus/host/lib/argusHome", () => ({
  argusHomeDir: () => "/tmp/argus-server-test",
}));

const pairing = {
  startPairing: vi.fn(),
  confirmPairing: vi.fn(async () => undefined),
  cancelPairing: vi.fn(),
};
vi.mock("@argus/host/services/remote/pairing", () => pairing);

const urls = {
  publicUrl: null as string | null,
  lanUrl: null as string | null,
  onLan: true,
};
vi.mock("@argus/host/services/remote/localGatewayServer", () => ({
  isGatewayOnLan: () => urls.onLan,
}));
vi.mock("@argus/host/services/remote/remoteService", () => ({
  getPublicUrl: () => urls.publicUrl,
  getLanUrl: () => urls.lanUrl,
}));

const {
  cancelServerPairing,
  confirmServerPairing,
  dismissServerPairing,
  getServerPairingState,
  setServerPairingListener,
  startServerPairing,
} = await import("./serverPairing");

/** Drive the callbacks `startPairing` was handed, as the real session would. */
function armWith(code = "PAIRCODE") {
  let captured: {
    onError: (m: string) => void;
    onPaired: (d: { label: string }) => void;
    onSas: (s: string) => void;
  } | null = null;
  pairing.startPairing.mockImplementation(
    async (_url: string, cb: NonNullable<typeof captured>) => {
      captured = cb;

      return { pairingCode: code, qrPayload: "{}" };
    },
  );

  return () => captured;
}

describe("server tray pairing", () => {
  beforeEach(() => {
    clipboardText.length = 0;
    written.clear();
    vi.clearAllMocks();
    urls.publicUrl = null;
    urls.lanUrl = null;
    urls.onLan = true;
    cancelServerPairing();
  });

  it("arms against the LAN url when no tunnel is up", async () => {
    urls.lanUrl = "ws://192.168.1.10:47617";
    armWith();

    await startServerPairing();

    expect(pairing.startPairing.mock.calls[0][0]).toBe(
      "ws://192.168.1.10:47617",
    );
    expect(getServerPairingState()).toEqual({ kind: "armed" });
  });

  it("prefers the tunnel url over the LAN one", async () => {
    urls.publicUrl = "wss://mini.example.ts.net";
    urls.lanUrl = "ws://192.168.1.10:47617";
    armWith();

    await startServerPairing();

    expect(pairing.startPairing.mock.calls[0][0]).toBe(
      "wss://mini.example.ts.net",
    );
  });

  it("refuses a LAN address the gateway is not listening on", async () => {
    urls.lanUrl = "ws://192.168.1.79:47617";
    urls.onLan = false;

    await startServerPairing();

    // Advertising it would hand out a code that can never be dialled.
    expect(pairing.startPairing).not.toHaveBeenCalled();
    expect(getServerPairingState().kind).toBe("error");
  });

  it("errors instead of arming when nothing is reachable", async () => {
    await startServerPairing();

    expect(pairing.startPairing).not.toHaveBeenCalled();
    expect(getServerPairingState().kind).toBe("error");
  });

  it("publishes the code to the clipboard and a 0600 file", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    armWith("THECODE");

    await startServerPairing();

    expect(clipboardText).toEqual(["THECODE"]);
    expect(written.get("/tmp/argus-server-test/pairing-code.txt")).toBe(
      "THECODE\n",
    );
  });

  it("surfaces the SAS so a human can compare it", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    const cb = armWith();
    await startServerPairing();

    cb()?.onSas("482913");

    expect(getServerPairingState()).toEqual({
      kind: "awaiting_sas",
      sas: "482913",
    });
  });

  it("can grant control without admin", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    const cb = armWith();
    await startServerPairing();
    cb()?.onSas("482913");

    await confirmServerPairing({ admin: false, control: true });

    // Driving agents is not the same as driving the machine.
    expect(pairing.confirmPairing).toHaveBeenCalledWith({
      admin: false,
      control: true,
    });
  });

  it("never grants admin from the view-only choice", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    const cb = armWith();
    await startServerPairing();
    cb()?.onSas("482913");

    await confirmServerPairing({ admin: false, control: false });

    expect(pairing.confirmPairing).toHaveBeenCalledWith({
      admin: false,
      control: false,
    });
  });

  it("passes admin through when full control is chosen", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    const cb = armWith();
    await startServerPairing();
    cb()?.onSas("482913");

    await confirmServerPairing({ admin: true, control: true });

    expect(pairing.confirmPairing).toHaveBeenCalledWith({
      admin: true,
      control: true,
    });
  });

  it("clears the code file once pairing settles", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    const cb = armWith();
    await startServerPairing();
    expect(written.size).toBe(1);

    cb()?.onPaired({ label: "Douwe's MacBook" });

    expect(written.size).toBe(0);
    expect(getServerPairingState()).toEqual({
      kind: "paired",
      label: "Douwe's MacBook",
    });
  });

  it("clears the code file when pairing fails", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    const cb = armWith();
    await startServerPairing();

    cb()?.onError("sas mismatch");

    expect(written.size).toBe(0);
    expect(getServerPairingState()).toEqual({
      kind: "error",
      message: "sas mismatch",
    });
  });

  it("cancelling cancels the real session and clears the code", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    armWith();
    await startServerPairing();

    cancelServerPairing();

    expect(pairing.cancelPairing).toHaveBeenCalled();
    expect(written.size).toBe(0);
    expect(getServerPairingState()).toEqual({ kind: "idle" });
  });

  it("only dismisses settled states", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    armWith();
    await startServerPairing();

    dismissServerPairing();

    expect(getServerPairingState()).toEqual({ kind: "armed" });
  });

  it("notifies the tray on every transition", async () => {
    urls.lanUrl = "ws://10.0.0.2:47617";
    const cb = armWith();
    const seen: string[] = [];
    setServerPairingListener(() => seen.push(getServerPairingState().kind));

    await startServerPairing();
    cb()?.onSas("123456");
    setServerPairingListener(null);

    expect(seen).toEqual(["armed", "awaiting_sas"]);
  });
});
