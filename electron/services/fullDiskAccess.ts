/**
 * Full Disk Access onboarding for macOS.
 *
 * Agents read and write files anywhere the user keeps projects — Documents,
 * Music, iCloud Drive, external drives, network mounts, etc. Each of those is
 * behind its own TCC consent dialog, and the set grows with every macOS
 * release. Priming individual folders is a losing game.
 *
 * Instead, ask the user once to grant Full Disk Access, which is a single
 * switch in System Settings that covers every current and future TCC-gated
 * location and is inherited cleanly by child processes (Claude CLI, shells,
 * tool subprocesses). We persist a flag in userData so the nudge only fires
 * until the user either grants it or dismisses it permanently.
 */

import { type BrowserWindow, app, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

const FLAG_FILENAME = "full-disk-access-nudged";
const SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

function flagPath(): string {
  return path.join(app.getPath("userData"), FLAG_FILENAME);
}

function alreadyNudged(): boolean {
  try {
    return fs.existsSync(flagPath());
  } catch {
    return false;
  }
}

function markNudged(): void {
  try {
    fs.writeFileSync(flagPath(), new Date().toISOString());
  } catch {
    /* best-effort — a missed flag just means we ask again next launch */
  }
}

export async function nudgeForFullDiskAccess(
  parent: BrowserWindow | null,
): Promise<void> {
  if (process.platform !== "darwin" || alreadyNudged()) {
    return;
  }

  const opts = {
    type: "info" as const,
    buttons: ["Open System Settings", "Not Now", "Don't Ask Again"],
    defaultId: 0,
    cancelId: 1,
    title: "Grant Full Disk Access",
    message: "Give Argus access to your files",
    detail:
      "Argus agents read and write files across your projects. macOS asks for consent per folder — Documents, Music, iCloud, external drives, network mounts, and more — which means a new prompt every time an agent touches a new location.\n\nGranting Full Disk Access once in System Settings covers all of them and stops the prompts.",
  };

  const { response } = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts);

  if (response === 0) {
    await shell.openExternal(SETTINGS_URL);
    markNudged();
  } else if (response === 2) {
    markNudged();
  }
  // "Not Now" (1) — don't set the flag; ask again next launch.
}
