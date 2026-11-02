import type { AppSettings } from "./types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyHostPrefsChange,
  connectHostPrefs,
  type HostPrefsIo,
  hostPrefsImportedCount,
  hydrateHostPrefs,
  mirrorToHost,
  onHostPrefChange,
  resetHostPrefs,
} from "./hostPrefs";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

function fakeHost(settings: AppSettings = {}, ui: Record<string, string> = {}) {
  const host = { settings: { ...settings }, ui: { ...ui } };
  const io: HostPrefsIo = {
    getAppSettings: async () => ({ ...host.settings }),
    setAppSettings: async (patch) => {
      host.settings = { ...host.settings, ...patch };
    },
    getUiState: async (key) => host.ui[key] ?? null,
    setUiState: async (key, value) => {
      host.ui[key] = value;
    },
  };

  return { host, io };
}

describe("host prefs", () => {
  beforeEach(() => {
    storage.clear();
    resetHostPrefs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies this renderer's values to the host on its first run", async () => {
    storage.set("argus:theme", "dark");
    storage.set(
      "argus:settings",
      JSON.stringify({ huddleDisplayName: "Ada", telemetryMode: "full" }),
    );
    storage.set("argus:simulatorBySession", JSON.stringify({ s1: "UDID" }));
    const { host, io } = fakeHost({ theme: "light" });

    const imported = await hydrateHostPrefs(io);

    expect(imported).toBe(4);
    expect(hostPrefsImportedCount()).toBe(4);
    expect(host.settings).toMatchObject({
      theme: "dark",
      huddle_display_name: "Ada",
      telemetry_mode: "full",
    });
    expect(JSON.parse(host.ui["runtime.ios_by_session"])).toEqual({
      s1: "UDID",
    });
  });

  it("takes the host's values after that", async () => {
    storage.set("argus:host-prefs-imported", "1");
    storage.set("argus:theme", "dark");
    storage.set(
      "argus:settings",
      JSON.stringify({ huddleDisplayName: "Ada", diffView: "unified" }),
    );
    const { io } = fakeHost(
      {
        theme: "light",
        huddle_display_name: "Grace",
        git_diff_layout: "split",
      },
      { "devices.tile_size": "300" },
    );

    await expect(hydrateHostPrefs(io)).resolves.toBe(0);

    expect(storage.get("argus:theme")).toBe("light");
    expect(JSON.parse(storage.get("argus:settings")!)).toEqual({
      huddleDisplayName: "Grace",
      diffView: "split",
    });
    expect(storage.get("argus:devices:gridTileSize")).toBe("300");
  });

  it("fills in what the host doesn't have yet", async () => {
    storage.set("argus:host-prefs-imported", "1");
    storage.set("argus:ui-scale", "large");
    const { host, io } = fakeHost();

    await hydrateHostPrefs(io);

    expect(host.settings.ui_scale).toBe("large");
  });

  it("ignores a host value it can't use", async () => {
    storage.set("argus:host-prefs-imported", "1");
    storage.set("argus:theme", "dark");
    const { io } = fakeHost({ theme: "sepia" as never });

    await hydrateHostPrefs(io);

    expect(storage.get("argus:theme")).toBe("dark");
  });

  it("keeps a paired host's recents in the renderer", async () => {
    storage.set(
      "argus:recentProjects",
      JSON.stringify([
        { path: "/a", name: "a", lastOpened: 2, hostId: "local" },
        { path: "/r", name: "r", lastOpened: 1, hostId: "mini" },
      ]),
    );
    const { host, io } = fakeHost();

    await hydrateHostPrefs(io);
    expect(JSON.parse(host.ui["home.recent_projects"])).toEqual([
      { path: "/a", lastOpened: 2 },
    ]);

    host.ui["home.recent_projects"] = JSON.stringify([
      { path: "/b", lastOpened: 5 },
    ]);
    resetHostPrefs();
    await hydrateHostPrefs(io);

    expect(JSON.parse(storage.get("argus:recentProjects")!)).toEqual([
      { path: "/b", lastOpened: 5, hostId: "local", name: "b" },
      { path: "/r", name: "r", lastOpened: 1, hostId: "mini" },
    ]);
  });

  it("writes changes through, once each", async () => {
    vi.useFakeTimers();
    const { io } = fakeHost();
    await hydrateHostPrefs(io);
    const setAppSettings = vi.spyOn(io, "setAppSettings");

    storage.set("argus:theme", "dark");
    mirrorToHost("argus:theme");
    mirrorToHost("argus:theme");
    await vi.runAllTimersAsync();

    expect(setAppSettings).toHaveBeenCalledTimes(1);
    expect(setAppSettings).toHaveBeenCalledWith({ theme: "dark" });

    mirrorToHost("argus:theme");
    await vi.runAllTimersAsync();
    expect(setAppSettings).toHaveBeenCalledTimes(1);
  });

  it("writes through from a popout that never read the host", async () => {
    vi.useFakeTimers();
    const { host, io } = fakeHost({ theme: "dark" });
    connectHostPrefs(io);

    storage.set("argus:platform", "web");
    mirrorToHost("argus:platform");
    await vi.runAllTimersAsync();

    expect(host.ui["runtime.platform"]).toBe(JSON.stringify("web"));
    expect(host.settings.theme).toBe("dark");
  });

  it("pulls what another window changed and reloads the stores reading it", async () => {
    const { host, io } = fakeHost({ theme: "dark" });
    storage.set("argus:host-prefs-imported", "1");
    await hydrateHostPrefs(io);
    const reload = vi.fn();
    onHostPrefChange("argus:theme", reload);

    host.settings.theme = "light";
    await applyHostPrefsChange({ settings: ["theme"] });
    expect(storage.get("argus:theme")).toBe("light");
    expect(reload).toHaveBeenCalledOnce();

    // Our own write echoing back changes nothing.
    await applyHostPrefsChange({ settings: ["theme"] });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps a local write that hasn't flushed yet over the host's older value", async () => {
    vi.useFakeTimers();
    const { host, io } = fakeHost({ theme: "dark" });
    storage.set("argus:host-prefs-imported", "1");
    await hydrateHostPrefs(io);
    storage.set("argus:theme", "system");
    mirrorToHost("argus:theme");

    host.settings.theme = "light";
    await applyHostPrefsChange({ settings: ["theme"] });
    expect(storage.get("argus:theme")).toBe("system");
    await vi.runAllTimersAsync();
    expect(host.settings.theme).toBe("system");
    vi.useRealTimers();
  });
});
