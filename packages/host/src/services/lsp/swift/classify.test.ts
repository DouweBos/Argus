import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifySwiftFile, isMobileOnlyPackage } from "./classify";

let root: string;

function touch(rel: string, text = ""): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);

  return file;
}

const dir = (rel: string) =>
  fs.mkdirSync(path.join(root, rel), { recursive: true });

describe("classifySwiftFile", () => {
  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "swift-cls-")),
    );
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("roots a package file at its nearest Package.swift", () => {
    touch("Package.swift");
    touch("Sub/Package.swift");
    const file = touch("Sub/Sources/Lib/A.swift");
    expect(classifySwiftFile(root, file)).toEqual({
      kind: "swiftpm",
      root: path.join(root, "Sub"),
    });
  });

  it("finds the project above the file, preferring a workspace", () => {
    dir("ios/App.xcodeproj");
    dir("ios/App.xcworkspace");
    const file = touch("ios/App/AppDelegate.swift");
    expect(classifySwiftFile(root, file)).toEqual({
      kind: "xcode",
      root,
      container: path.join(root, "ios/App.xcworkspace"),
    });
  });

  it("scans the worktree when the project isn't above the file", () => {
    dir("Project/App.xcodeproj");
    const file = touch("Sources/Feature/View.swift");
    expect(classifySwiftFile(root, file)).toMatchObject({
      kind: "xcode",
      container: path.join(root, "Project/App.xcodeproj"),
    });
  });

  it("ignores projects in Pods, DerivedData, node_modules and .build", () => {
    dir("Pods/Pods.xcodeproj");
    dir("node_modules/x/ios/X.xcodeproj");
    dir("DerivedData/Y.xcworkspace");
    dir(".build/checkouts/z/Z.xcodeproj");
    const file = touch("Tools/one.swift");
    expect(classifySwiftFile(root, file)).toEqual({ kind: "loose", root });
  });

  it("keeps a Mac-compatible package in an app on SwiftPM", () => {
    dir("App.xcodeproj");
    touch(
      "Packages/Core/Package.swift",
      "platforms: [.iOS(.v17), .macOS(.v14)]",
    );
    const file = touch("Packages/Core/Sources/Core/A.swift");
    expect(classifySwiftFile(root, file)).toEqual({
      kind: "swiftpm",
      root: path.join(root, "Packages/Core"),
    });
  });

  it("analyses an iOS-only package in an app with the app", () => {
    dir("App.xcodeproj");
    touch("Packages/UI/Package.swift", "platforms: [.iOS(.v17)]");
    const file = touch("Packages/UI/Sources/UI/A.swift");
    expect(classifySwiftFile(root, file)).toMatchObject({ kind: "xcode" });
  });

  it("hands every file to the project once it has a build server", () => {
    dir("App.xcodeproj");
    touch("Packages/Core/Package.swift");
    const file = touch("Packages/Core/Sources/Core/A.swift");
    expect(
      classifySwiftFile(root, file, { xcodeHandlesPackages: true }),
    ).toMatchObject({ kind: "xcode" });
  });

  it("groups loose files that sit together", () => {
    touch("scripts/a.swift");
    const file = touch("scripts/b.swift");
    expect(classifySwiftFile(root, file)).toEqual({
      kind: "loose_group",
      root: path.join(root, "scripts"),
    });
  });
});

describe("isMobileOnlyPackage", () => {
  it.each([
    ["no platforms", 'let p = Package(name: "A")', false],
    ["iOS only", "platforms: [.iOS(.v17)]", true],
    ["iOS and macOS", "platforms: [.iOS(.v17), .macOS(.v14)]", false],
    ["visionOS", "platforms: [.visionOS(.v1)]", true],
  ])("%s", (_, manifest, expected) => {
    expect(isMobileOnlyPackage(manifest)).toBe(expected);
  });
});
