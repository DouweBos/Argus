/**
 * The real sourcekit-lsp: a Swift package gets cross-file answers and no
 * false errors, and an Xcode project without a build server gets no server at
 * all (it would report `No such module 'UIKit'`). Skipped without Xcode.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function hasSourceKit(): boolean {
  try {
    execFileSync("xcrun", ["--find", "sourcekit-lsp"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
}

let tmp: string;
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
    });
  },
);
