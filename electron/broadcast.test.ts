/**
 * The renderer sink: host events reach every live window, and destroyed ones
 * are skipped rather than throwing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { emitHostEvent, resetHostEventSinks } from "@argus/host/bus";
import { installRendererEventSink } from "./broadcast";

const windows = vi.hoisted(
  () => [] as { destroyed: boolean; sent: unknown[][] }[],
);

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () =>
      windows.map((w) => ({
        isDestroyed: () => w.destroyed,
        webContents: { send: (...args: unknown[]) => w.sent.push(args) },
      })),
  },
}));

describe("installRendererEventSink", () => {
  afterEach(() => {
    windows.length = 0;
    resetHostEventSinks();
  });

  it("forwards to every live window and skips destroyed ones", () => {
    const live = { destroyed: false, sent: [] as unknown[][] };
    const popout = { destroyed: false, sent: [] as unknown[][] };
    const gone = { destroyed: true, sent: [] as unknown[][] };
    windows.push(live, popout, gone);

    installRendererEventSink();
    emitHostEvent("session:updated", { id: "s1" });

    expect(live.sent).toEqual([["session:updated", { id: "s1" }]]);
    expect(popout.sent).toEqual([["session:updated", { id: "s1" }]]);
    expect(gone.sent).toEqual([]);
  });

  it("stops forwarding once unsubscribed", () => {
    const win = { destroyed: false, sent: [] as unknown[][] };
    windows.push(win);

    installRendererEventSink()();
    emitHostEvent("session:updated", { id: "s1" });

    expect(win.sent).toEqual([]);
  });
});
