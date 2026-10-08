/**
 * Which language server runs for which language, and where its binary comes
 * from: bundled with the host (run on the host's own Node), the Xcode
 * toolchain, or the user's PATH. Candidates are tried in order; nothing is
 * ever downloaded.
 */

import type { LspLanguage, LspServerSource } from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bundledPath, PACKAGED_LANGUAGE_SERVERS } from "../code/bundled";

type Candidate =
  | { kind: "bundled"; packaged: string; dev: string; args: string[] }
  | { kind: "path"; command: string; args: string[] }
  | { kind: "toolchain"; tool: string; args: string[] };

interface ServerSpec {
  candidates: Candidate[];
  /** Answers `workspace/configuration` and seeds `didChangeConfiguration`. */
  settings?: Record<string, unknown>;
  initializationOptions?: () => Record<string, unknown>;
}

const LS = PACKAGED_LANGUAGE_SERVERS;

const bundled = (packaged: string, dev: string): Candidate => ({
  kind: "bundled",
  packaged: `${LS}/${packaged}`,
  dev,
  args: ["--stdio"],
});

/** The TypeScript the TS server falls back to when the worktree has none. */
export function bundledTsserverPath(): string {
  return bundledPath(
    `${LS}/typescript/lib/tsserver.js`,
    "bundled-typescript/lib/tsserver.js",
  );
}

const SPECS: Record<LspLanguage, ServerSpec> = {
  typescript: {
    candidates: [
      bundled(
        "typescript-language-server/lib/cli.mjs",
        "typescript-language-server/lib/cli.mjs",
      ),
    ],
    // The worktree's own `node_modules/typescript` wins; TypeScript 7 ships no
    // tsserver.js, so such a worktree falls back to the bundled 6.x too.
    initializationOptions: () => ({
      hostInfo: "argus",
      tsserver: { fallbackPath: bundledTsserverPath() },
    }),
  },
  json: {
    candidates: [
      bundled(
        "json.js",
        "vscode-langservers-extracted/lib/json-language-server/node/jsonServerMain.js",
      ),
    ],
    initializationOptions: () => ({
      provideFormatter: true,
      handledSchemaProtocols: ["file", "http", "https"],
    }),
    settings: {
      json: {
        validate: { enable: true },
        format: { enable: true },
        schemas: [
          {
            fileMatch: ["package.json"],
            url: "https://json.schemastore.org/package.json",
          },
          {
            fileMatch: ["tsconfig.json", "tsconfig.*.json"],
            url: "https://json.schemastore.org/tsconfig.json",
          },
        ],
      },
    },
  },
  css: {
    candidates: [
      bundled(
        "css.js",
        "vscode-langservers-extracted/lib/css-language-server/node/cssServerMain.js",
      ),
    ],
    initializationOptions: () => ({ provideFormatter: true }),
    settings: {
      css: { validate: true },
      scss: { validate: true },
      less: { validate: true },
    },
  },
  html: {
    candidates: [
      bundled(
        "html.js",
        "vscode-langservers-extracted/lib/html-language-server/node/htmlServerMain.js",
      ),
    ],
    initializationOptions: () => ({
      provideFormatter: true,
      embeddedLanguages: { css: true, javascript: true },
    }),
    settings: { html: { validate: { scripts: true, styles: true } } },
  },
  yaml: {
    candidates: [
      bundled("yaml.js", "yaml-language-server/out/server/src/server.js"),
    ],
    // Its messages live beside the package, which a bundle has no beside to.
    initializationOptions: () => ({
      l10nPath: bundledPath(`${LS}/yaml-l10n`, "yaml-language-server/l10n"),
    }),
    settings: {
      yaml: {
        validate: true,
        hover: true,
        completion: true,
        format: { enable: true },
        schemaStore: { enable: true },
      },
    },
  },
  swift: {
    candidates: [
      { kind: "toolchain", tool: "sourcekit-lsp", args: [] },
      { kind: "path", command: "sourcekit-lsp", args: [] },
    ],
  },
  c: {
    candidates: [
      { kind: "toolchain", tool: "clangd", args: [] },
      { kind: "path", command: "clangd", args: [] },
    ],
  },
  kotlin: {
    candidates: [{ kind: "path", command: "kotlin-lsp", args: ["--stdio"] }],
  },
  python: {
    candidates: [
      { kind: "path", command: "pyright-langserver", args: ["--stdio"] },
      { kind: "path", command: "basedpyright-langserver", args: ["--stdio"] },
    ],
  },
  go: { candidates: [{ kind: "path", command: "gopls", args: [] }] },
  rust: { candidates: [{ kind: "path", command: "rust-analyzer", args: [] }] },
  ruby: { candidates: [{ kind: "path", command: "ruby-lsp", args: [] }] },
};

/** LSP language ids, as editors send them, to the server that handles them. */
const LANGUAGE_IDS: Record<string, LspLanguage> = {
  typescript: "typescript",
  typescriptreact: "typescript",
  javascript: "typescript",
  javascriptreact: "typescript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  yaml: "yaml",
  swift: "swift",
  c: "c",
  cpp: "c",
  "objective-c": "c",
  "objective-cpp": "c",
  kotlin: "kotlin",
  python: "python",
  go: "go",
  rust: "rust",
  ruby: "ruby",
};

const EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  yaml: "yaml",
  yml: "yaml",
  swift: "swift",
  c: "c",
  h: "objective-c",
  m: "objective-c",
  mm: "objective-cpp",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  kt: "kotlin",
  kts: "kotlin",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
};

export function languageForId(languageId: string): LspLanguage | null {
  return LANGUAGE_IDS[languageId] ?? null;
}

/** The LSP language id for a path, from its extension. */
export function languageIdForPath(relativePath: string): string | null {
  const ext = path.extname(relativePath).slice(1).toLowerCase();

  return EXTENSIONS[ext] ?? null;
}

export function serverSettings(
  language: LspLanguage,
): Record<string, unknown> | undefined {
  return SPECS[language].settings;
}

export interface ResolvedServer {
  command: string;
  args: string[];
  source: LspServerSource;
  env?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}

export type ServerResolution = ResolvedServer | { missing: string };

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);

    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** `command` on the PATH the host fixed up from the login shell at boot. */
export function findOnPath(command: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && isExecutable(path.join(dir, command))) {
      return path.join(dir, command);
    }
  }

  return null;
}

function xcrunFind(tool: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    execFile("xcrun", ["--find", tool], { timeout: 10_000 }, (err, stdout) => {
      const found = stdout?.trim();
      resolve(!err && found && isExecutable(found) ? found : null);
    });
  });
}

async function resolveCandidate(
  candidate: Candidate,
): Promise<ResolvedServer | null> {
  switch (candidate.kind) {
    case "bundled": {
      const script = bundledPath(candidate.packaged, candidate.dev);
      if (!fs.existsSync(script)) {
        return null;
      }

      // The host's own Node — under Electron, its binary in Node mode.
      return {
        command: process.execPath,
        args: [script, ...candidate.args],
        source: "bundled",
        env: { ELECTRON_RUN_AS_NODE: "1" },
      };
    }
    case "toolchain": {
      const found = await xcrunFind(candidate.tool);

      return found
        ? { command: found, args: candidate.args, source: "toolchain" }
        : null;
    }
    case "path": {
      const found = findOnPath(candidate.command);

      return found
        ? { command: found, args: candidate.args, source: "path" }
        : null;
    }
  }
}

function describeMissing(candidates: Candidate[]): string {
  const names = candidates.map((c) => {
    switch (c.kind) {
      case "bundled":
        return "the bundled server";
      case "toolchain":
        return `${c.tool} (Xcode)`;
      case "path":
        return c.command;
    }
  });

  return `Not found: ${[...new Set(names)].join(", ")}`;
}

export type ServerResolver = (
  language: LspLanguage,
) => Promise<ServerResolution>;

const defaultResolver: ServerResolver = async (language) => {
  const spec = SPECS[language];
  for (const candidate of spec.candidates) {
    const resolved = await resolveCandidate(candidate);
    if (resolved) {
      return {
        ...resolved,
        initializationOptions: spec.initializationOptions?.(),
      };
    }
  }

  return { missing: describeMissing(spec.candidates) };
};

let resolver: ServerResolver = defaultResolver;

export function resolveServer(
  language: LspLanguage,
): Promise<ServerResolution> {
  return resolver(language);
}

/** Swap where servers come from (tests). */
export function setServerResolverForTest(fn: ServerResolver | null): void {
  resolver = fn ?? defaultResolver;
}
