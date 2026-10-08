/**
 * The real sourcekit-lsp: a Swift package gets cross-file answers and no
 * false errors, and an Xcode project without a build server gets no server at
 * all (it would report `No such module 'UIKit'`). Skipped without Xcode. With
 * xcode-build-server installed, an iOS app is built once and then gets the
 * same answers through it.
 */

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "@argus/host/bus";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));
vi.mock("../session/git", () => ({ git: vi.fn(async () => "") }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { appState } = await import("../../state");
const manager = await import("./manager");
const documents = await import("./documents");
const features = await import("./features");
const { findXcodeBuildServer, setXcodeBuildServerForTest } =
  await import("./swift/buildServer");

const xcodeBuildServer = findXcodeBuildServer();
const APP_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/swift-app",
);

function hasSourceKit(): boolean {
  try {
    execFileSync("xcrun", ["--find", "sourcekit-lsp"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
}

let tmp: string;

/**
 * `xcodebuild -list` leaves a DerivedData folder named for the project's path,
 * and xcode-build-server a cache folder for its root: remove this run's.
 */
async function forgetApp(app: string): Promise<void> {
  if (!fs.existsSync(app)) {
    return;
  }
  fs.rmSync(
    path.join(
      os.homedir(),
      "Library/Caches/xcode-build-server",
      app.replaceAll("/", "-"),
    ),
    { recursive: true, force: true },
  );
  const { stdout } = await promisify(execFile)(
    "xcodebuild",
    ["-showBuildSettings", "-json", "-scheme", "Fixture"],
    { cwd: app, timeout: 60_000, maxBuffer: 32 << 20 },
  ).catch(() => ({ stdout: "[]" }));
  const symroot = (
    JSON.parse(stdout) as { buildSettings?: { SYMROOT?: string } }[]
  )[0]?.buildSettings?.SYMROOT;
  const derived = symroot && path.resolve(symroot, "../..");
  if (derived?.includes("/DerivedData/Fixture-")) {
    fs.rmSync(derived, { recursive: true, force: true });
  }
}
const diagnostics = new Map<string, unknown[]>();

function write(rel: string, text: string): string {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);

  return text;
}

function session(id: string, dir: string): void {
  appState.sessions.set(id, { path: path.join(tmp, dir) } as never);
}

const GREETER = `public struct Greeter {
  public init() {}
  public func greet(_ name: String) -> String { "Hello, \\(name)" }
}
`;
const USE = `import Foundation

public func welcome() -> String {
  let greeter = Greeter()
  return greeter.greet("world")
}
`;
const APP = `import UIKit

final class AppDelegate: UIResponder, UIApplicationDelegate {
  func color() -> UIColor { Helper().color() }
}
`;

describe.skipIf(process.platform !== "darwin" || !hasSourceKit())(
  "sourcekit-lsp",
  () => {
    beforeAll(() => {
      tmp = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "argus-swift-smoke-")),
      );
      resetHostEventSinks();
      addHostEventSink((channel, args) => {
        if (channel.startsWith("lsp:diagnostics:")) {
          const event = args[0] as { relativePath: string; diagnostics: [] };
          diagnostics.set(
            `${channel.slice(16)}:${event.relativePath}`,
            event.diagnostics,
          );
        }
      });
    });

    // sourcekit-lsp may still be writing its index as it goes.
    afterAll(async () => {
      manager.stopLanguageServers();
      resetHostEventSinks();
      await forgetApp(path.join(tmp, "app"));
      await fs.promises.rm(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 300,
      });
    }, 30_000);

    it("answers across a package's files without false errors", async () => {
      write(
        "repo/Lib/Package.swift",
        `// swift-tools-version:5.9
import PackageDescription
let package = Package(name: "Lib", targets: [.target(name: "Lib")])
`,
      );
      write("repo/Lib/Sources/Lib/Greeter.swift", GREETER);
      write("repo/Lib/Sources/Lib/Use.swift", USE);
      session("pkg", "repo");
      const rel = "Lib/Sources/Lib/Use.swift";
      await documents.lspDidOpen("pkg", rel, "swift", 1, USE);
      await vi.waitFor(() => expect(diagnostics.has(`pkg:${rel}`)).toBe(true), {
        timeout: 60_000,
        interval: 200,
      });
      expect(diagnostics.get(`pkg:${rel}`)).toEqual([]);
      expect(manager.lspStatus("pkg").servers).toEqual([
        { language: "swift", state: "ready", source: "toolchain", root: "Lib" },
      ]);
      const definition = await vi.waitFor(
        async () => {
          const found = await features.lspDefinition("pkg", rel, {
            line: 3,
            character: 18,
          });
          expect(found.length).toBeGreaterThan(0);

          return found;
        },
        { timeout: 30_000, interval: 500 },
      );
      expect(definition[0].relativePath).toBe("Lib/Sources/Lib/Greeter.swift");
    }, 120_000);

    it("starts nothing for an Xcode project without a build server", async () => {
      fs.mkdirSync(path.join(tmp, "plain/App.xcodeproj"), { recursive: true });
      const text = write("plain/App/AppDelegate.swift", APP);
      session("plain", "plain");
      setXcodeBuildServerForTest(null);
      await documents.lspDidOpen(
        "plain",
        "App/AppDelegate.swift",
        "swift",
        1,
        text,
      );
      await vi.waitFor(() =>
        expect(manager.lspStatus("plain").servers).toEqual([
          expect.objectContaining({ state: "needs_setup" }),
        ]),
      );
      expect(
        manager
          .allHandles()
          .filter((h) => h.sessionId === "plain")
          .every((h) => h.proc === null),
      ).toBe(true);
      expect(diagnostics.has("plain:App/AppDelegate.swift")).toBe(false);
      setXcodeBuildServerForTest(undefined);
    });

    it.skipIf(!xcodeBuildServer)(
      "uses xcode-build-server once the app has been built",
      async () => {
        const app = path.join(tmp, "app");
        fs.cpSync(APP_FIXTURE, app, { recursive: true });
        execFileSync("git", ["init", "-q"], { cwd: app });
        const build = [
          "-scheme",
          "Fixture",
          "-destination",
          "generic/platform=iOS Simulator",
          "-derivedDataPath",
          "dd",
          "build",
        ];
        fs.writeFileSync(
          path.join(app, ".argus.json"),
          JSON.stringify({
            run: [{ title: "Build", command: `xcodebuild ${build.join(" ")}` }],
          }),
        );
        session("app", "app");
        const rel = "App/AppDelegate.swift";
        const text = fs.readFileSync(path.join(app, rel), "utf8");
        await documents.lspDidOpen("app", rel, "swift", 1, text);
        await vi.waitFor(
          () =>
            expect(manager.lspStatus("app").servers).toEqual([
              expect.objectContaining({
                state: "needs_setup",
                action: "build_once",
              }),
            ]),
          { timeout: 60_000, interval: 200 },
        );
        expect(
          JSON.parse(
            fs.readFileSync(path.join(app, "buildServer.json"), "utf8"),
          ),
        ).toMatchObject({
          kind: "xcode",
          scheme: "Fixture",
          build_root: path.join(app, "dd"),
        });
        expect(
          execFileSync("git", ["status", "--porcelain"], {
            cwd: app,
          }).toString(),
        ).not.toContain("buildServer.json");

        await promisify(execFile)("xcodebuild", [...build, "-quiet"], {
          cwd: app,
          timeout: 300_000,
        });
        await vi.waitFor(
          () => expect(diagnostics.has(`app:${rel}`)).toBe(true),
          { timeout: 90_000, interval: 300 },
        );
        expect(manager.lspStatus("app").servers).toEqual([
          expect.objectContaining({ state: "ready", source: "toolchain" }),
        ]);
        await vi.waitFor(
          async () => {
            expect(diagnostics.get(`app:${rel}`)).toEqual([]);
            const found = await features.lspDefinition("app", rel, {
              line: 11,
              character: 32,
            });
            expect(found[0]?.relativePath).toBe("App/Helper.swift");
          },
          { timeout: 60_000, interval: 1000 },
        );
      },
      600_000,
    );
  },
);
