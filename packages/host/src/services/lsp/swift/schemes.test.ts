import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { excludeFromGit } from "./buildServer";
import {
  appSchemesIn,
  pickScheme,
  runCommandDerivedData,
  runCommandSchemes,
} from "./schemes";

describe("scheme selection", () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "swift-scheme-")),
    );
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function scheme(dir: string, name: string, buildable: string): void {
    const file = path.join(
      root,
      dir,
      "xcshareddata/xcschemes",
      `${name}.xcscheme`,
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `<BuildableReference BuildableName = "${buildable}">`,
    );
  }

  it("prefers the scheme the run command builds", () => {
    expect(
      pickScheme({
        schemes: ["Kit", "Shop", "ShopWidget"],
        appSchemes: ["Shop"],
        runSchemes: ["ShopWidget"],
        containerName: "Shop",
      }),
    ).toEqual({ scheme: "ShopWidget", guessed: false });
  });

  it("then the app scheme named after the project, then the first app", () => {
    const base = { schemes: ["A", "Pods-Shop", "Shop", "Zed"], runSchemes: [] };
    expect(
      pickScheme({
        ...base,
        appSchemes: ["Shop", "Zed"],
        containerName: "Shop",
      }),
    ).toEqual({ scheme: "Shop", guessed: true });
    expect(
      pickScheme({ ...base, appSchemes: ["Zed"], containerName: "Shop" }),
    ).toEqual({ scheme: "Zed", guessed: false });
    expect(
      pickScheme({ ...base, appSchemes: [], containerName: "Other" }),
    ).toEqual({ scheme: "A", guessed: true });
    expect(
      pickScheme({
        schemes: [],
        appSchemes: [],
        runSchemes: [],
        containerName: "X",
      }),
    ).toBeNull();
  });

  it("reads -scheme and -derivedDataPath from xcodebuild run commands", () => {
    const commands = [
      { command: "npx expo start -scheme nope", cwd: root },
      {
        command:
          "xcodebuild -workspace App.xcworkspace -scheme 'My App' -derivedDataPath build/dd build",
        cwd: path.join(root, "ios"),
      },
      { command: 'xcodebuild test -scheme "Unit Tests"', cwd: root },
    ];
    expect(runCommandSchemes(commands.map((c) => c.command))).toEqual([
      "My App",
      "Unit Tests",
    ]);
    expect(runCommandDerivedData(commands)).toBe(
      path.join(root, "ios/build/dd"),
    );
    expect(
      runCommandDerivedData([
        { command: "xcodebuild -derivedDataPath $DD build", cwd: root },
      ]),
    ).toBeNull();
  });

  it("finds app schemes in a project and in a workspace's projects", () => {
    scheme("App.xcodeproj", "App", "App.app");
    scheme("App.xcodeproj", "Kit", "Kit.framework");
    scheme("Pods/Pods.xcodeproj", "Pods-App", "Pods_App.framework");
    fs.mkdirSync(path.join(root, "App.xcworkspace"));
    fs.writeFileSync(
      path.join(root, "App.xcworkspace/contents.xcworkspacedata"),
      `<FileRef location = "group:App.xcodeproj"></FileRef>
       <FileRef location = "group:Pods/Pods.xcodeproj"></FileRef>`,
    );
    scheme("App.xcworkspace", "Staging", "App.app");
    expect(appSchemesIn(path.join(root, "App.xcodeproj"))).toEqual(["App"]);
    expect(appSchemesIn(path.join(root, "App.xcworkspace")).sort()).toEqual([
      "App",
      "Staging",
    ]);
  });

  it("keeps buildServer.json out of git through the shared exclude file", async () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    await excludeFromGit(root, "buildServer.json");
    await excludeFromGit(root, "buildServer.json");
    const exclude = fs.readFileSync(
      path.join(root, ".git/info/exclude"),
      "utf8",
    );
    expect(exclude.match(/^\/buildServer\.json$/gm)).toHaveLength(1);
    fs.writeFileSync(path.join(root, "buildServer.json"), "{}");
    expect(
      execFileSync("git", ["status", "--porcelain"], { cwd: root }).toString(),
    ).toBe("");
  });
});
