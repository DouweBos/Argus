/**
 * What the UI needs to know about where a project's worktrees live: the
 * resolved location, which level of the cascade decided it, and whether the
 * drive holding it is currently connected.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { loadAppSettings } from "../appSettings/store";
import { loadUserProjectSettings } from "../userProjectSettings/store";
import {
  mountRootFor,
  pathAvailability,
  volumeLabel,
} from "./volumeAvailability";
import {
  resolveWorktreeRoot,
  type WorktreePurpose,
  type WorktreeRootSource,
} from "./worktreeLocation";

export interface WorktreeStorage {
  /** Base dir set app-wide, if any. */
  app_base: string | null;
  /** Base dir set for this project, if any. Personal, never checked in. */
  project_base: string | null;
  /** Automation base dir set app-wide, if any. */
  automation_app_base: string | null;
  /** Automation base dir set for this project, if any. */
  automation_project_base: string | null;
  /** The base dir used when neither is set. */
  default_base: string;
  /** Absolute dir holding this project's worktrees right now. */
  root: string;
  source: WorktreeRootSource;
  state: "available" | "unavailable";
  /** Mount point the root depends on; null when it is on the internal disk. */
  volume: string | null;
  volume_label: string | null;
  /** The same four, for worktrees automations open. Equal to the above when
   * no automation base is set. */
  automation_root: string;
  automation_source: WorktreeRootSource;
  automation_state: "available" | "unavailable";
  automation_volume: string | null;
  automation_volume_label: string | null;
}

export interface WorktreeLocationProbe {
  exists: boolean;
  /** Set when the path can't be used, phrased for the user. */
  reason: string | null;
  /** True when the path is on a drive that can be disconnected. */
  removable: boolean;
  volume: string | null;
  volume_label: string | null;
  writable: boolean;
}

/** The base directory used when nothing is configured. */
export function defaultWorktreesBase(): string {
  return path.join(argusHomeDir(), "worktrees");
}

/** Resolved location plus drive state for one purpose. */
function locationFor(repoRoot: string, purpose: WorktreePurpose) {
  const { root, source } = resolveWorktreeRoot(repoRoot, purpose);
  const availability = pathAvailability(root);
  const volume =
    availability.state === "volume_missing"
      ? availability.volume
      : mountRootFor(root, process.platform);

  return {
    root,
    source,
    state: (availability.state === "volume_missing"
      ? "unavailable"
      : "available") as "available" | "unavailable",
    volume,
    volume_label: volume ? volumeLabel(volume) : null,
  };
}

export function getWorktreeStorage(repoRoot: string): WorktreeStorage {
  const appSettings = loadAppSettings();
  const projectSettings = loadUserProjectSettings(repoRoot);
  const user = locationFor(repoRoot, "user");
  const automation = locationFor(repoRoot, "automation");

  return {
    app_base: appSettings.worktrees_base_dir ?? null,
    project_base: projectSettings.worktrees_base_dir ?? null,
    automation_app_base: appSettings.automation_worktrees_base_dir ?? null,
    automation_project_base:
      projectSettings.automation_worktrees_base_dir ?? null,
    default_base: defaultWorktreesBase(),
    ...user,
    automation_root: automation.root,
    automation_source: automation.source,
    automation_state: automation.state,
    automation_volume: automation.volume,
    automation_volume_label: automation.volume_label,
  };
}

/**
 * Check a candidate base directory before it is saved. Never creates
 * anything — a Browse dialog shouldn't leave directories behind.
 */
export function probeWorktreeLocation(
  baseDir: string,
  repoRoot?: string,
): WorktreeLocationProbe {
  const target = baseDir.trim();
  const volume = mountRootFor(target, process.platform);
  const base: WorktreeLocationProbe = {
    exists: false,
    reason: null,
    removable: volume !== null,
    volume,
    volume_label: volume ? volumeLabel(volume) : null,
    writable: false,
  };

  if (!target || !path.isAbsolute(target)) {
    return { ...base, reason: "Enter an absolute path." };
  }
  if (
    repoRoot &&
    (target === repoRoot || target.startsWith(`${repoRoot}${path.sep}`))
  ) {
    return {
      ...base,
      reason: "Worktrees can't live inside the repository they come from.",
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    // Absent is fine — it gets created on save — unless the drive is out,
    // in which case creating it would shadow the real mount point.
    return pathAvailability(target).state === "volume_missing"
      ? {
          ...base,
          reason: `${base.volume_label} isn't connected.`,
        }
      : base;
  }
  if (!stat.isDirectory()) {
    return { ...base, exists: true, reason: "That path is not a folder." };
  }

  try {
    fs.accessSync(target, fs.constants.W_OK);
  } catch {
    return {
      ...base,
      exists: true,
      reason: "Argus can't write to that folder.",
    };
  }

  return { ...base, exists: true, writable: true };
}
