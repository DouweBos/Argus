/**
 * Prompt sections beside the runtime guide: the ticket and design tools Argus
 * signs in to for the agent, and the related projects it can start. Builders
 * are pure; the gatherers read live state.
 */

import path from "node:path";
import { appState } from "../../state";
import { figmaApi } from "../integrations/figma/service";
import { linearApi } from "../integrations/service";
import { loadArgusConfig } from "../session/argusConfig";

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
    "Before coding, read the ticket with `linear_get_issue` and open every Figma frame it links with `figma_get_frame`.";
  if (!ctx.figma) {
    read =
      "Before coding, read the ticket with `linear_get_issue`, comments and screenshots included.";
  } else if (!ctx.linear) {
    read =
      "Before coding, open every Figma frame the task links with `figma_get_frame`.";
  }
  const lines = [
    "## Tickets and designs",
    "",
    `Argus is signed in to ${services} for you; use its MCP tools over any other route.`,
    "",
    `- ${read}`,
  ];
  if (ctx.figma && ctx.deviceControl) {
    lines.push(
      "- After your last code change, compare each screen you touched with its frame using `design_compare` and fix what differs. A comparison made before your last edit doesn't count.",
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
