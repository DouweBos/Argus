import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../simulator/ios", () => ({ listSimulators: async () => [] }));
vi.mock("../cli/conductor", () => ({ getConductorDir: () => "/nowhere" }));

const {
  TVOS_INPROC_UNAVAILABLE,
  friendlyInjectError,
  inprocLibraryPath,
  inprocUnavailableReason,
} = await import("./inprocSupport");

let tmp: string;
let conductorDir: string;
let home: string;

function writeFramework(drivers: string, platform: string): void {
  const dir = path.join(drivers, `${platform}-inproc`, "Conductor.framework");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "Conductor"), "");
}

describe("inprocSupport", () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inproc-"));
    conductorDir = path.join(tmp, "conductor");
    home = path.join(tmp, "home");
    const pkg = path.join(
      conductorDir,
      "node_modules",
      "@houwert",
      "conductor",
    );
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), '{"version":"1.2.3"}');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("inprocLibraryPath", () => {
    it("is unknown until conductor has downloaded its drivers", () => {
      expect(inprocLibraryPath("tvos", conductorDir, home)).toBeNull();
    });

    it("points into the versioned driver cache once it is complete", () => {
      const cache = path.join(home, ".conductor", "drivers", "1.2.3");
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(path.join(cache, ".complete"), "");

      expect(inprocLibraryPath("tvos", conductorDir, home)).toBe(
        path.join(cache, "tvos-inproc", "Conductor.framework", "Conductor"),
      );
    });
  });

  describe("inprocUnavailableReason", () => {
    it("refuses tvOS when the drivers carry no tvOS library", () => {
      const cache = path.join(home, ".conductor", "drivers", "1.2.3");
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(path.join(cache, ".complete"), "");
      writeFramework(cache, "ios");

      expect(
        inprocUnavailableReason(
          "tvos",
          inprocLibraryPath("tvos", conductorDir, home),
        ),
      ).toBe(TVOS_INPROC_UNAVAILABLE);
      expect(
        inprocUnavailableReason(
          "ios",
          inprocLibraryPath("ios", conductorDir, home),
        ),
      ).toBeNull();
    });

    it("allows tvOS once a release ships the library", () => {
      const drivers = path.join(
        conductorDir,
        "node_modules",
        "@houwert",
        "conductor",
        "drivers",
      );
      writeFramework(drivers, "tvos");

      expect(
        inprocUnavailableReason(
          "tvos",
          inprocLibraryPath("tvos", conductorDir, home),
        ),
      ).toBeNull();
    });
  });

  describe("friendlyInjectError", () => {
    it("replaces conductor's build hint with a sentence", () => {
      const raw =
        'launch-app "tv.app" — failed --inject: in-process library not found at /x/tvos-inproc/Conductor.framework/Conductor. Build it with packages/ios-inproc/tools/build-inproc-dylib.sh';

      expect(friendlyInjectError(raw, "tvos")).toBe(TVOS_INPROC_UNAVAILABLE);
      expect(friendlyInjectError("app crashed", "ios")).toBe("app crashed");
    });
  });
});
