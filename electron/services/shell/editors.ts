/**
 * External "open in" target detection + launch.
 *
 * Supports editors (VS Code, Cursor, Codex, IntelliJ IDEA, Xcode, Android
 * Studio) and terminal apps (iTerm, Terminal). On macOS we prefer
 * `open -a <AppName>` when the .app bundle is installed, and fall back to a
 * CLI on PATH (`code`, `cursor`, `idea`, etc.).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { resolveBinaryOnPath } from "../../lib/whichBinary";

const execFileP = promisify(execFile);

export interface EditorDescriptor {
  id: string;
  name: string;
  available: boolean;
}

interface EditorDef {
  id: string;
  name: string;
  /** macOS .app bundle names to probe under /Applications and ~/Applications. */
  appNames: string[];
  /** CLI fallbacks to probe on PATH. */
  clis: string[];
}

const EDITORS: EditorDef[] = [
  {
    id: "vscode",
    name: "VS Code",
    appNames: ["Visual Studio Code.app"],
    clis: ["code"],
  },
  {
    id: "cursor",
    name: "Cursor",
    appNames: ["Cursor.app"],
    clis: ["cursor"],
  },
  {
    id: "codex",
    name: "Codex",
    appNames: ["Codex.app"],
    clis: ["codex"],
  },
  {
    id: "intellij",
    name: "IntelliJ IDEA",
    appNames: ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"],
    clis: ["idea"],
  },
  {
    id: "xcode",
    name: "Xcode",
    appNames: ["Xcode.app"],
    clis: ["xed"],
  },
  {
    id: "androidstudio",
    name: "Android Studio",
    appNames: ["Android Studio.app"],
    clis: ["studio"],
  },
  {
    id: "iterm",
    name: "iTerm",
    appNames: ["iTerm.app"],
    clis: [],
  },
  {
    id: "terminal",
    name: "Terminal",
    appNames: ["Terminal.app"],
    clis: [],
  },
];

const APP_SEARCH_ROOTS = [
  "/Applications",
  `${homedir()}/Applications`,
  "/System/Applications",
  "/System/Applications/Utilities",
];

function appExists(appName: string): boolean {
  return APP_SEARCH_ROOTS.some((root) => existsSync(`${root}/${appName}`));
}

async function cliExists(cli: string): Promise<boolean> {
  return (await resolveBinaryOnPath(cli)) !== null;
}

async function isAvailable(def: EditorDef): Promise<boolean> {
  if (def.appNames.some(appExists)) {
    return true;
  }
  for (const cli of def.clis) {
    if (await cliExists(cli)) {
      return true;
    }
  }

  return false;
}

export async function listEditors(): Promise<EditorDescriptor[]> {
  return Promise.all(
    EDITORS.map(async (def) => ({
      id: def.id,
      name: def.name,
      available: await isAvailable(def),
    })),
  );
}

/**
 * Launch a user-defined editor. `command` may be:
 *   - a path to a `.app` bundle ("/Applications/Zed.app", "Zed.app") → `open -a`
 *   - a CLI on PATH ("zed", "subl", "mvim") → executed directly with the path
 *     as its first argument
 */
export async function openInCustomEditor(
  command: string,
  path: string,
): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) {
    throw "Editor command is empty";
  }

  if (trimmed.endsWith(".app")) {
    const appArg = trimmed.includes("/")
      ? trimmed
      : trimmed.replace(/\.app$/, "");
    await execFileP("/usr/bin/open", ["-a", appArg, path]);

    return;
  }

  await execFileP(trimmed, [path]);
}

export async function openInEditor(
  editorId: string,
  path: string,
): Promise<void> {
  const def = EDITORS.find((e) => e.id === editorId);
  if (!def) {
    throw `Unknown editor: ${editorId}`;
  }

  const appHit = def.appNames.find(appExists);
  if (appHit) {
    const appName = appHit.replace(/\.app$/, "");
    await execFileP("/usr/bin/open", ["-a", appName, path]);

    return;
  }

  for (const cli of def.clis) {
    if (await cliExists(cli)) {
      await execFileP(cli, [path]);

      return;
    }
  }

  throw `${def.name} is not installed`;
}
