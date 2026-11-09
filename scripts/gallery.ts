/**
 * The Mac app's component gallery — Storybook for the SwiftUI views. Builds
 * the Debug app without its Node host, then renders the stories registered in
 * `clients/apple/ArgusDesktop/Gallery/` to PNGs, dark and light, with no window
 * ever showing. Or `--browse` to click through them live.
 *
 *   pnpm gallery [filter] [--theme dark|light] [--out <dir>] [--no-build] [--browse]
 *   pnpm gallery [filter] --ios [--device "iPad Pro 13-inch (M5)"]  (default: iPhone 17)
 *
 * `--ios` renders the iOS app's stories (`clients/apple/ArgusRemote/Gallery/`,
 * same ids as the Mac's) on a simulator of its own, through conductor.
 *
 * Prints one PNG path per line; `<out>/index.json` lists each story's
 * fixtures that went unanswered.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { renderIos } from "./galleryIos";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DERIVED = path.join(ROOT, ".build/mac-gallery-dd");
const BUNDLE = path.join(ROOT, ".build/gallery/Argus.app");
const BUNDLE_ID = "dev.houwert.argus.mac.gallery";

interface Entry {
  id: string;
  theme: string;
  path: string;
  unanswered: string[];
}

function parse(argv: string[]) {
  const options = {
    filter: "",
    themes: "dark,light",
    out: path.join(os.tmpdir(), "argus-gallery"),
    build: true,
    browse: false,
    ios: false,
    device: "iPhone 17",
    outSet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--theme") {
      options.themes = argv[++i] ?? options.themes;
    } else if (arg === "--out") {
      options.out = path.resolve(argv[++i] ?? options.out);
      options.outSet = true;
    } else if (arg === "--ios") {
      options.ios = true;
    } else if (arg === "--device") {
      options.device = argv[++i] ?? options.device;
    } else if (arg === "--no-build") {
      options.build = false;
    } else if (arg === "--browse") {
      options.browse = true;
    } else if (!arg.startsWith("--")) {
      options.filter = arg;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

async function build(): Promise<void> {
  try {
    await run(
      "xcodebuild",
      [
        "-project",
        "clients/apple/ArgusRemote.xcodeproj",
        "-scheme",
        "ArgusDesktop",
        "-configuration",
        "Debug",
        "-destination",
        "platform=macOS,arch=arm64",
        "-derivedDataPath",
        DERIVED,
        "build",
        "-quiet",
        "ARGUS_SKIP_HOST_BUNDLE=YES",
      ],
      { cwd: ROOT, maxBuffer: 1024 * 1024 * 64 },
    );
  } catch (error) {
    const out = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`;
    const errors = out.split("\n").filter((line) => line.includes("error:"));
    throw new Error(
      `xcodebuild failed:\n${(errors.length ? errors : out.split("\n").slice(-30)).join("\n")}`,
    );
  }
  // Its own bundle id, so its defaults never touch a developer's "Argus Dev".
  fs.rmSync(path.dirname(BUNDLE), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(BUNDLE), { recursive: true });
  await run("ditto", [
    path.join(DERIVED, "Build/Products/Debug/Argus.app"),
    BUNDLE,
  ]);
  await run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleIdentifier ${BUNDLE_ID}`,
    path.join(BUNDLE, "Contents/Info.plist"),
  ]);
  await run("codesign", ["--force", "--deep", "--sign", "-", BUNDLE]);
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  if (options.ios) {
    await renderIos({
      root: ROOT,
      filter: options.filter,
      themes: options.themes,
      out: options.outSet
        ? options.out
        : path.join(os.tmpdir(), "argus-gallery-ios"),
      build: options.build,
      device: options.device,
    });

    return;
  }
  if (options.build) {
    await build();
  }
  if (!fs.existsSync(BUNDLE)) {
    throw new Error("no gallery build yet — drop --no-build");
  }

  fs.rmSync(options.out, { recursive: true, force: true });
  fs.mkdirSync(options.out, { recursive: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-gallery-home-"));
  const child = spawn(path.join(BUNDLE, "Contents/MacOS/Argus"), [], {
    env: {
      ...process.env,
      ARGUS_HOME: home,
      ARGUS_GALLERY: options.browse ? "browse" : "render",
      ARGUS_GALLERY_FILTER: options.filter,
      ARGUS_GALLERY_THEMES: options.themes,
      ARGUS_GALLERY_OUT: options.out,
    },
    stdio: options.browse ? "inherit" : ["ignore", "ignore", "inherit"],
  });
  if (options.browse) {
    return;
  }

  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("exit", (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  fs.rmSync(home, { recursive: true, force: true });
  const index = path.join(options.out, "index.json");
  if (code !== 0 || !fs.existsSync(index)) {
    throw new Error(`gallery exited with ${code}`);
  }
  const entries = JSON.parse(fs.readFileSync(index, "utf8")) as Entry[];
  for (const entry of entries) {
    const missing = entry.unanswered.length
      ? `  (no fixture: ${entry.unanswered.join(", ")})`
      : "";
    process.stdout.write(`${entry.path}${missing}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
