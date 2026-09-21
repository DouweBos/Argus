import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestArgusJson } from "./argusJson";

interface InferredConfig {
  browser_url?: string;
  platforms?: string[];
  run: { command: string; restartOnRerun: boolean; title: string }[];
  setup: { commands: string[]; copy: string[]; symlink: string[] };
  workspace_env: { base_value: number; name: string }[];
}

let tmpRoot: string;

function writeFile(rel: string, content: string): void {
  const full = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function mkdir(rel: string): void {
  fs.mkdirSync(path.join(tmpRoot, rel), { recursive: true });
}

function suggest(): {
  config: InferredConfig;
  inferredFrom: string[];
  signalLabels: string[];
} {
  const { config, inferredFrom, signals } = suggestArgusJson(tmpRoot);

  return {
    config: config as unknown as InferredConfig,
    inferredFrom,
    signalLabels: signals.map((s) => s.label),
  };
}

describe("suggestArgusJson", () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-suggest-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("empty repo", () => {
    it("returns a minimal default with no platforms", () => {
      const { config, signalLabels } = suggest();

      expect(config.platforms).toBeUndefined();
      expect(config.setup.commands).toEqual([]);
      expect(config.setup.copy).toEqual([]);
      expect(config.run).toEqual([]);
      expect(signalLabels).toEqual([]);
    });
  });

  describe("jS/TS frameworks", () => {
    it("detects Vite and picks pnpm runner", () => {
      writeFile(
        "package.json",
        JSON.stringify({
          name: "web",
          devDependencies: { vite: "^5.0.0" },
          scripts: { dev: "vite" },
        }),
      );
      writeFile("pnpm-lock.yaml", "");

      const { config, signalLabels } = suggest();

      expect(config.platforms).toEqual(["web"]);
      expect(config.browser_url).toBe("http://localhost:5173");
      expect(config.setup.commands).toContain("pnpm install");
      expect(config.run).toContainEqual({
        title: "Dev",
        command: "pnpm run dev",
        restartOnRerun: true,
      });
      expect(config.workspace_env.some((e) => e.name === "VITE_PORT")).toBe(
        true,
      );
      expect(signalLabels).toContain("Vite");
      expect(signalLabels).toContain("pnpm");
    });

    it("detects React Native with an ios/ subdir", () => {
      writeFile(
        "package.json",
        JSON.stringify({
          dependencies: { "react-native": "0.73.0" },
          scripts: { start: "react-native start" },
        }),
      );
      writeFile("yarn.lock", "");
      mkdir("ios");
      writeFile("ios/Podfile", "platform :ios, '15.0'");
      mkdir("ios/MyApp.xcworkspace");

      const { config, signalLabels } = suggest();

      expect(config.platforms).toEqual(["android", "ios"].sort());
      expect(config.setup.copy).toContain("ios/Pods");
      expect(config.setup.commands).toContain("yarn install");
      expect(config.setup.commands).toContain("cd ios && pod install");
      expect(signalLabels).toContain("React Native");
      expect(signalLabels).toContain("CocoaPods");
      expect(signalLabels).toContain("Xcode");
    });
  });

  describe("native iOS at repo root", () => {
    it("detects an xcodeproj-only repo with no package.json", () => {
      mkdir("MyApp.xcodeproj");

      const { config, inferredFrom, signalLabels } = suggest();

      expect(config.platforms).toEqual(["ios"]);
      expect(inferredFrom).toContain("native-ios");
      expect(signalLabels).toContain("iOS project");
      expect(signalLabels).toContain("Xcode");
      // No Podfile → no pod install and no Pods entry
      expect(config.setup.commands).not.toContain("pod install");
      expect(config.setup.copy).not.toContain("Pods");
    });

    it("detects a root Podfile and adds pod install + copies Pods", () => {
      mkdir("MyApp.xcworkspace");
      writeFile("Podfile", "platform :ios, '16.0'");

      const { config, signalLabels } = suggest();

      expect(config.platforms).toEqual(["ios"]);
      expect(config.setup.commands).toContain("pod install");
      expect(config.setup.copy).toContain("Pods");
      expect(signalLabels).toContain("CocoaPods");
    });

    it("detects a Swift Package Manager project and copies .build", () => {
      writeFile("Package.swift", "// swift-tools-version:5.9\n");

      const { config, signalLabels } = suggest();

      expect(config.platforms).toEqual(["ios"]);
      expect(config.setup.copy).toContain(".build");
      expect(signalLabels).toContain("Swift Package Manager");
    });
  });

  describe("native Android at repo root", () => {
    it("detects a repo with settings.gradle and gradlew at root", () => {
      writeFile("settings.gradle.kts", "rootProject.name = 'MyApp'");
      writeFile("build.gradle.kts", "");
      writeFile("gradlew", "#!/bin/sh");
      mkdir("app");
      mkdir("app/build");

      const { config, inferredFrom, signalLabels } = suggest();

      expect(config.platforms).toEqual(["android"]);
      expect(inferredFrom).toContain("native-android");
      expect(config.setup.copy).toContain(".gradle");
      expect(config.setup.copy).toContain("build");
      expect(config.setup.copy).toContain("app/build");
      expect(signalLabels).toContain("Android project");
      expect(signalLabels).toContain("Gradle");
    });

    it("does not misidentify a plain build.gradle without gradlew as native root", () => {
      writeFile("build.gradle", "");

      const { config } = suggest();

      expect(config.platforms).toBeUndefined();
    });
  });

  describe("flutter", () => {
    it("detects a Flutter app and adds flutter pub get + flutter run", () => {
      writeFile(
        "pubspec.yaml",
        [
          "name: my_app",
          "dependencies:",
          "  flutter:",
          "    sdk: flutter",
        ].join("\n"),
      );
      mkdir("ios");
      writeFile("ios/Podfile", "");
      mkdir("android");
      mkdir("web");

      const { config, inferredFrom, signalLabels } = suggest();

      expect(inferredFrom).toContain("flutter");
      expect(config.platforms).toEqual(["android", "ios", "web"]);
      expect(config.setup.commands).toContain("flutter pub get");
      expect(config.setup.commands).toContain("cd ios && pod install");
      expect(config.setup.copy).toContain(".dart_tool");
      expect(config.setup.copy).toContain("ios/Pods");
      expect(config.run).toContainEqual({
        title: "Flutter",
        command: "flutter run",
        restartOnRerun: true,
      });
      expect(signalLabels).toContain("Flutter");
    });

    it("does not treat a non-Flutter pubspec as Flutter", () => {
      writeFile(
        "pubspec.yaml",
        ["name: server_tool", "environment:", "  sdk: '>=3.0.0 <4.0.0'"].join(
          "\n",
        ),
      );

      const { inferredFrom } = suggest();

      expect(inferredFrom).not.toContain("flutter");
    });
  });
});
