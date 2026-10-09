/**
 * Vendors a curated subset of the Material Icon Theme into ArgusUI: an asset
 * catalog of SVGs and the file-name / extension / folder-name lookup tables,
 * filtered from the theme's own generated manifest.
 *
 *   git clone https://github.com/material-extensions/vscode-material-icon-theme /tmp/mit
 *   (cd /tmp/mit && npm i --ignore-scripts && mkdir -p dist \
 *     && npx tsx src/scripts/icons/generateJson.ts > dist/material-icons.json \
 *     && npx tsx src/scripts/svg/generateOpenFolderIcons.ts)
 *   pnpm gen:file-icons /tmp/mit
 */

import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(
  import.meta.dirname,
  "../clients/apple/ArgusUI/Sources/ArgusUI/Resources",
);

const FILE_ICONS = [
  "file",
  "document",
  "swift",
  "objective-c",
  "objective-cpp",
  "h",
  "hpp",
  "c",
  "cpp",
  "kotlin",
  "java",
  "gradle",
  "xml",
  "android",
  "typescript",
  "typescript-def",
  "react_ts",
  "javascript",
  "react",
  "json",
  "nodejs",
  "npm",
  "pnpm",
  "yarn",
  "tsconfig",
  "eslint",
  "prettier",
  "babel",
  "vite",
  "jest",
  "vitest",
  "test-ts",
  "test-js",
  "test-jsx",
  "markdown",
  "readme",
  "license",
  "changelog",
  "contributing",
  "yaml",
  "toml",
  "tune",
  "git",
  "docker",
  "console",
  "python",
  "ruby",
  "gemfile",
  "go",
  "go-mod",
  "rust",
  "css",
  "sass",
  "less",
  "html",
  "svg",
  "image",
  "font",
  "pdf",
  "zip",
  "lock",
  "settings",
  "graphql",
  "database",
  "table",
  "log",
  "fastlane",
  "metro",
  "expo",
  "biome",
  "editorconfig",
  "codeowners",
  "makefile",
  "dart",
  "certificate",
  "key",
  "video",
  "audio",
  "proto",
  "diff",
];

const FOLDER_ICONS = [
  "folder",
  "folder-src",
  "folder-app",
  "folder-components",
  "folder-resource",
  "folder-images",
  "folder-test",
  "folder-scripts",
  "folder-docs",
  "folder-config",
  "folder-node",
  "folder-github",
  "folder-ios",
  "folder-android",
  "folder-packages",
  "folder-lib",
  "folder-dist",
  "folder-public",
  "folder-hook",
  "folder-views",
  "folder-utils",
  "folder-css",
  "folder-font",
  "folder-api",
  "folder-typescript",
  "folder-store",
  "folder-fastlane",
  "folder-gradle",
  "folder-i18n",
  "folder-mock",
  "folder-vscode",
  "folder-tools",
  "folder-server",
  "folder-routes",
  "folder-theme",
];

// Apple-platform files the theme leaves unmapped; only applied where it has no entry.
const EXTRA_FILE_NAMES: Record<string, string> = {
  "package.resolved": "lock",
};
const EXTRA_EXTENSIONS: Record<string, string> = {
  entitlements: "xml",
  xcconfig: "settings",
  pbxproj: "settings",
  xcworkspacedata: "xml",
  xcscheme: "xml",
  xctestplan: "json",
  xcstrings: "json",
  strings: "document",
};
// Bundles that look like folders in a tree, keyed by their extension.
const FOLDER_EXTENSIONS: Record<string, string> = {
  xcodeproj: "folder-ios",
  xcworkspace: "folder-ios",
  xcassets: "folder-images",
  imageset: "folder-images",
  appiconset: "folder-images",
};

interface Manifest {
  iconDefinitions: Record<string, { iconPath: string }>;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
}

function main() {
  const theme = process.argv[2];
  if (!theme) {
    throw new Error("usage: gen-file-icons <material-icon-theme checkout>");
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(theme, "dist/material-icons.json"), "utf8"),
  ) as Manifest;
  const files = new Set(FILE_ICONS);
  const folders = new Set(FOLDER_ICONS);
  const icons = [
    ...FILE_ICONS,
    ...FOLDER_ICONS.flatMap((f) => [f, `${f}-open`]),
  ];
  for (const icon of icons) {
    if (!manifest.iconDefinitions[icon]) {
      throw new Error(`no icon named ${icon} in the theme`);
    }
  }

  const pick = (table: Record<string, string>, keep: Set<string>) =>
    Object.fromEntries(
      Object.entries(table)
        .map(([key, icon]): [string, string] => [key.toLowerCase(), icon])
        .filter(([, icon]) => keep.has(icon))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const withExtras = (
    table: Record<string, string>,
    extras: Record<string, string>,
  ) => ({ ...extras, ...table });

  const lookup = {
    fileNames: withExtras(pick(manifest.fileNames, files), EXTRA_FILE_NAMES),
    fileExtensions: withExtras(
      pick(manifest.fileExtensions, files),
      EXTRA_EXTENSIONS,
    ),
    folderNames: pick(manifest.folderNames, folders),
    folderExtensions: FOLDER_EXTENSIONS,
  };

  const catalog = path.join(OUT, "FileIcons.xcassets");
  fs.rmSync(catalog, { recursive: true, force: true });
  fs.mkdirSync(catalog, { recursive: true });
  writeJson(path.join(catalog, "Contents.json"), {
    info: { author: "xcode", version: 1 },
  });
  for (const icon of icons) {
    writeImageSet(theme, catalog, icon);
  }
  fs.writeFileSync(path.join(OUT, "FileIcons.json"), JSON.stringify(lookup));
  fs.copyFileSync(
    path.join(theme, "LICENSE"),
    path.join(OUT, "FileIcons-LICENSE.txt"),
  );
  process.stdout.write(`${icons.length} icons written to ${catalog}\n`);
}

/// The theme's default icons are drawn for dark backgrounds; `_light` ones, when present, for light.
function writeImageSet(theme: string, catalog: string, icon: string) {
  const dir = path.join(catalog, `${icon}.imageset`);
  fs.mkdirSync(dir);
  const light = path.join(theme, "icons", `${icon}_light.svg`);
  const images: object[] = [];
  copySvg(
    path.join(theme, "icons", `${icon}.svg`),
    path.join(dir, `${icon}.svg`),
  );
  if (fs.existsSync(light)) {
    copySvg(light, path.join(dir, `${icon}_light.svg`));
    images.push({ filename: `${icon}_light.svg`, idiom: "universal" });
    images.push({
      appearances: [{ appearance: "luminosity", value: "dark" }],
      filename: `${icon}.svg`,
      idiom: "universal",
    });
  } else {
    images.push({ filename: `${icon}.svg`, idiom: "universal" });
  }
  writeJson(path.join(dir, "Contents.json"), {
    images,
    info: { author: "xcode", version: 1 },
    properties: { "preserves-vector-representation": true },
  });
}

/// actool pre-renders each SVG at its natural size; pinning that to 16 pt keeps the
/// rasters small (the theme's viewBoxes run up to 3473) and pixel-exact at the default size.
function copySvg(from: string, to: string) {
  const svg = fs.readFileSync(from, "utf8");
  if (/<svg[^>]*\swidth=/.test(svg)) {
    throw new Error(`${from} already has a width`);
  }
  fs.writeFileSync(to, svg.replace("<svg", '<svg width="16" height="16"'));
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

main();
