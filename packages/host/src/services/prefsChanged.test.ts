import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addHostEventSink } from "@argus/host/bus";
import { saveAppSettings } from "./appSettings/store";
import { PREFS_CHANGED } from "./prefsChanged";
import { setUiState } from "./uiState";

describe("prefs:changed", () => {
  let home: string;
  let events: unknown[];
  let untap: () => void;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-prefs-"));
    process.env.ARGUS_HOME = home;
    events = [];
    untap = addHostEventSink((channel, args) => {
      if (channel === PREFS_CHANGED) {
        events.push(args[0]);
      }
    });
  });

  afterEach(() => {
    untap();
    delete process.env.ARGUS_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("names the keys every write touched, so another window can refetch them", () => {
    saveAppSettings({ theme: "dark", ui_scale: "large" });
    setUiState("runtime.platform", "ios");

    expect(events).toEqual([
      { settings: ["theme", "ui_scale"] },
      { ui_state: ["runtime.platform"] },
    ]);
  });
});
