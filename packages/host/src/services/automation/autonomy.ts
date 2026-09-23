/**
 * Resolving the gate's inputs from live state: how far this automation may go
 * in this repo, and how many sessions it already has running.
 *
 * Effective autonomy is `min(app default, automation.autonomy, project
 * ceiling)`. A repo can always cap itself lower than the app; never higher.
 */

import type { Automation, AutomationGuardrails, AutonomyLevel } from "./models";
import { loadAppSettings } from "../appSettings/store";
import { loadArgusConfig } from "../session/argusConfig";
import { isOnMissingVolume } from "../session/volumeAvailability";
import {
  DEFAULT_AUTONOMY,
  isAutonomyLevel,
  minAutonomy,
  normalizeGuardrails,
} from "./guardrails";
import { liveOwnedSessions } from "./ownedSessions";
import { listProposals } from "./proposals/manager";

/** App-wide cap on automation sessions running at once. */
export const DEFAULT_MAX_CONCURRENT_AUTOMATION_SESSIONS = 3;

export interface AutomationPolicy {
  autonomy: AutonomyLevel;
  guardrails: AutomationGuardrails;
  maxTotalSessions: number;
  /** The repo turned this automation off entirely. */
  disabledByProject: boolean;
}

/** The app-level default, or `"propose"` when unset or nonsense. */
export function appDefaultAutonomy(): AutonomyLevel {
  const configured = loadAppSettings().default_autonomy;

  return isAutonomyLevel(configured) ? configured : DEFAULT_AUTONOMY;
}

export function maxConcurrentAutomationSessions(): number {
  const configured = loadAppSettings().max_concurrent_automation_sessions;

  return typeof configured === "number" && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_CONCURRENT_AUTOMATION_SESSIONS;
}

/** The repo's `automations` block, or null when it has none / is unreadable. */
function projectAutomationConfig(repoRoot: string | null) {
  if (!repoRoot) {
    return null;
  }
  try {
    return loadArgusConfig(repoRoot).automations ?? null;
  } catch {
    // An unreadable project config must not raise the ceiling.
    return null;
  }
}

/**
 * What this automation is allowed to do in this repo. `repoRoot` is null when
 * the decision is not repo-bound yet, in which case only the app default and
 * the automation's own setting apply.
 */
export function resolvePolicy(
  automation: Automation,
  repoRoot: string | null,
): AutomationPolicy {
  const project = projectAutomationConfig(repoRoot);
  const guardrails = normalizeGuardrails(automation.guardrails);

  // A project on a disconnected drive reads as "no config", which would drop
  // whatever ceiling and denylist it declares. We cannot know what it asked
  // for, so assume the most cautious answer rather than the most permissive.
  if (repoRoot && isOnMissingVolume(repoRoot)) {
    return {
      autonomy: "propose",
      guardrails,
      maxTotalSessions: maxConcurrentAutomationSessions(),
      disabledByProject: false,
    };
  }

  // Project denylists are additive: a repo can forbid more paths, never fewer.
  const projectDenylist = project?.path_denylist ?? [];
  if (projectDenylist.length > 0) {
    guardrails.path_denylist = [
      ...new Set([...guardrails.path_denylist, ...projectDenylist]),
    ];
  }

  const disabledByProject = (project?.disabled ?? []).some(
    (id) => id === automation.id || id === automation.template_id,
  );

  const autonomy = disabledByProject
    ? "propose"
    : minAutonomy(
        appDefaultAutonomy(),
        automation.autonomy,
        project?.autonomy_ceiling,
      );

  return {
    autonomy,
    guardrails,
    maxTotalSessions: maxConcurrentAutomationSessions(),
    disabledByProject,
  };
}

/**
 * The run's own level, before any single proposal picks a repo: the lowest
 * ceiling across every project in scope, so the host agent's permission mode
 * matches the most restrictive repo it can touch.
 */
export function resolveHostAutonomy(automation: Automation): AutonomyLevel {
  const repoRoots = automation.scope.repo_roots;
  if (repoRoots.length === 0) {
    return resolvePolicy(automation, null).autonomy;
  }

  return minAutonomy(
    ...repoRoots.map(
      (repoRoot) => resolvePolicy(automation, repoRoot).autonomy,
    ),
  );
}

/**
 * What "in flight" means: a session the automation started that still exists.
 *
 * The agent going idle is not the end of the work — the branch is still open,
 * unreviewed and unmerged, and counting it as finished would let an automation
 * stack up branches forever without ever reaching `max_concurrent_sessions`.
 * The slot frees when the session is deleted, which is what merging or
 * abandoning it does.
 */
export interface ActiveSessionCounts {
  forAutomation: number;
  total: number;
}

export function countActiveAutomationSessions(
  automationId: string,
): ActiveSessionCounts {
  const live = liveOwnedSessions();
  let forAutomation = live.filter(
    (s) => s.automation_id === automationId,
  ).length;
  let total = live.length;

  // A proposal that cleared the gate but whose session is still being created
  // holds its slot too, or two proposals emitted back to back both take it.
  for (const proposal of listProposals({ status: "auto_started" })) {
    if (proposal.session_id !== null) {
      continue;
    }
    total += 1;
    if (proposal.automation_id === automationId) {
      forAutomation += 1;
    }
  }

  return { forAutomation, total };
}
