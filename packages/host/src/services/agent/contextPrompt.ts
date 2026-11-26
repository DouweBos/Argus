/**
 * Prompt sections beside the runtime guide: the ticket and design tools Argus
 * signs in to for the agent, and the related projects it can start. Builders
 * are pure; the gatherers read live state.
 */

import type { Session } from "../session/models";
import path from "node:path";
import { appState } from "../../state";
import { figmaApi } from "../integrations/figma/service";
import { linearApi } from "../integrations/service";
import { loadArgusConfig } from "../session/argusConfig";
import { crossProjectPrimary } from "../session/crossProjectState";

export interface IntegrationsContext {
  linear: boolean;
  figma: boolean;
  /** `design_compare` needs a device to screenshot. */
  deviceControl: boolean;
}

/** Which integrations are connected, the same gate `registerIntegrationTools` uses. */
export function connectedIntegrations(): { linear: boolean; figma: boolean } {
  return { linear: linearApi() !== null, figma: figmaApi() !== null };
}

/** A few lines on when to reach for the ticket and design tools, or null when neither is connected. */
export function buildIntegrationsSection(
  ctx: IntegrationsContext,
): string | null {
  if (!ctx.linear && !ctx.figma) {
    return null;
  }
  const services = [ctx.linear && "Linear", ctx.figma && "Figma"]
    .filter(Boolean)
    .join(" and ");
  let read =
    "When the task names a ticket, read it with `linear_get_issue` and open the Figma frames it links with `figma_get_frame`.";
  if (!ctx.figma) {
    read =
      "When the task names a ticket, read it with `linear_get_issue`, comments and screenshots included.";
  } else if (!ctx.linear) {
    read = "When the task links a Figma frame, open it with `figma_get_frame`.";
  }
  const lines = [
    "## Tickets and designs",
    "",
    `Argus is signed in to ${services}; use its MCP tools over any other route.`,
    "",
    `- ${read}`,
  ];
  if (ctx.figma && ctx.deviceControl) {
    lines.push(
      "- When you built a screen from a Figma frame, compare it with `design_compare` after your last code change and fix what differs.",
    );
  }

  return lines.join("\n");
}

export interface RelatedProjectContext {
  path: string;
  description: string;
  runCommands: { title: string; command: string }[];
  /** Branches of its worktree sessions; `root` is always addressable. */
  worktrees: string[];
}

/** Worktrees named per related project, past which the list is cut. */
const MAX_WORKTREES = 5;

/** The project's related projects, each with its run commands and sessions. */
export function relatedProjectsContext(
  repoRoot: string,
): RelatedProjectContext[] {
  let related: { path: string; description: string }[] = [];
  try {
    related = loadArgusConfig(repoRoot).related_projects ?? [];
  } catch {
    return [];
  }

  return related.map((rel) => {
    const abs = path.resolve(repoRoot, rel.path);
    let runCommands: RelatedProjectContext["runCommands"] = [];
    try {
      runCommands = (loadArgusConfig(abs).run ?? []).map((r) => ({
        title: r.title,
        command: r.command,
      }));
    } catch {
      // Unreadable config: listed without run commands.
    }
    const worktrees = [...appState.sessions.values()]
      .filter((s) => s.repo_root === abs && s.kind === "worktree")
      .map((s) => s.branch);

    return { path: abs, description: rel.description, runCommands, worktrees };
  });
}

/** Where the related projects are and how to start them, or null without any. */
export function buildRelatedProjectsSection(
  projects: RelatedProjectContext[],
): string | null {
  if (projects.length === 0) {
    return null;
  }
  const lines = [
    "## Related projects",
    "",
    'Start a related project\'s run commands with `trigger_run` (its `project_path`, `session: "root"` or a worktree branch, and the `title`), never as a Bash background process, and watch them with `wait_for_terminal` / `read_terminal`.',
    "",
  ];
  for (const p of projects) {
    lines.push(`- **${p.description}** — \`${p.path}\``);
    lines.push(
      p.runCommands.length > 0
        ? `  - Run commands: ${p.runCommands.map((r) => `\`${r.title}\` (\`${r.command}\`)`).join(", ")}`
        : "  - No run commands configured.",
    );
    if (p.worktrees.length > 0) {
      const shown = p.worktrees.slice(0, MAX_WORKTREES);
      const more = p.worktrees.length - shown.length;
      lines.push(
        `  - Worktrees besides \`root\`: ${shown.map((b) => `\`${b}\``).join(", ")}${more > 0 ? ` and ${more} more (\`list_sessions\`)` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export interface CrossProjectRepo {
  repoRoot: string;
  path: string;
  branch: string;
  /** The agent's own working directory. */
  current: boolean;
}

/** Every repository of the session's cross-project session; empty for a single-repo one. */
export function crossProjectContext(session: Session): CrossProjectRepo[] {
  const primary = crossProjectPrimary(session);
  if (!primary?.linked_repos?.length) {
    return [];
  }
  const repos: CrossProjectRepo[] = [
    {
      repoRoot: primary.repo_root,
      path: primary.path,
      branch: primary.branch,
      current: primary.id === session.id,
    },
    ...primary.linked_repos.map((r) => ({
      repoRoot: r.repo_root,
      path: appState.sessions.get(r.session_id)?.path || r.worktree_path,
      branch: r.branch,
      current: r.session_id === session.id,
    })),
  ];

  return repos.filter((r) => r.path);
}

/** The other repositories' worktrees, which the runner opens beside its cwd. */
export function crossProjectDirs(repos: CrossProjectRepo[]): string[] {
  return repos.filter((r) => !r.current).map((r) => r.path);
}

/** Where each repository of a cross-project session is checked out, or null for a single-repo one. */
export function buildCrossProjectSection(
  repos: CrossProjectRepo[],
): string | null {
  if (repos.length < 2) {
    return null;
  }
  const lines = [
    "## Cross-project session",
    "",
    "This session spans several repositories, each checked out in its own git worktree. Work in each one at its worktree path; commit in each repository separately, since each lands on its own base (merged or as its own pull request).",
    "",
  ];
  for (const r of repos) {
    const where = r.current ? " (your working directory)" : "";
    lines.push(
      `- \`${r.repoRoot}\` — worktree \`${r.path}\`${where}, branch \`${r.branch}\``,
    );
  }

  return lines.join("\n");
}
