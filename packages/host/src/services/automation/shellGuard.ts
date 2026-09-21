/**
 * The ladder, enforced at the shell.
 *
 * The MCP gate only sees MCP calls. An auto-started session gets an ordinary
 * agent with Bash in it, and `git push` / `gh pr create` from that agent would
 * otherwise walk straight past every rung. So every agent Argus starts on
 * behalf of an automation — the run's host and each session it started — has
 * its publishing commands checked here, on the permission request itself,
 * before the CLI is allowed to run them.
 *
 * Two layers, both in Node, neither in the prompt:
 * 1. `automationDisallowedTools` is handed to the CLI as `--disallowed-tools`,
 *    so the recognised spellings never even reach a permission request.
 * 2. `automationPermissionPreHook` denies the request outright for anything
 *    that does reach us, whatever the permission mode says.
 */

import type { Automation, AutonomyLevel } from "./models";
import type { PermissionPreHook } from "../llm/runners/types";
import { appState } from "../../state";
import { resolveHostAutonomy, resolvePolicy } from "./autonomy";
import { atLeastAutonomy } from "./guardrails";
import { getAutomation, listAutomationRuns } from "./manager";
import { automationOwningSession } from "./ownedSessions";
import { listProposals } from "./proposals/manager";

/** Wrappers whose quoted argument is itself a command. */
const COMMAND_WRAPPERS = new Set([
  "bash",
  "command",
  "dash",
  "env",
  "nohup",
  "sh",
  "sudo",
  "time",
  "xargs",
  "zsh",
]);

/** `git` flags that swallow the token after them. */
const GIT_VALUE_FLAGS = new Set([
  "-C",
  "-c",
  "--exec-path",
  "--git-dir",
  "--work-tree",
]);

/** A publishing action found in a command, and the rung it needs. */
export interface PublishingAction {
  level: AutonomyLevel;
  what: string;
}

function basename(word: string): string {
  const cut = word.lastIndexOf("/");

  return cut === -1 ? word : word.slice(cut + 1);
}

/** Split on shell separators. Quotes are ignored on purpose — over-splitting
 * only makes the scan see more candidate commands, never fewer. */
function splitSegments(command: string): string[] {
  return command
    .split(/\|\||&&|[\n;|&]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(segment: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch) || ch === "(" || ch === ")") {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) {
    out.push(current);
  }

  return out;
}

/** Drop leading `FOO=bar` assignments so `GIT_DIR=x git push` still resolves. */
function stripAssignments(words: string[]): string[] {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) {
    i += 1;
  }

  return words.slice(i);
}

/** The subcommand of a `git` invocation, skipping its global flags. */
function gitSubcommand(words: string[]): string | null {
  let i = 1;
  while (i < words.length) {
    const word = words[i]!;
    if (!word.startsWith("-")) {
      return word;
    }
    i += GIT_VALUE_FLAGS.has(word) ? 2 : 1;
  }

  return null;
}

/** The bare (non-flag) words of a `gh` invocation, in order. */
function ghWords(words: string[]): string[] {
  return words.slice(1).filter((w) => !w.startsWith("-"));
}

function inspectWords(raw: string[]): PublishingAction | null {
  const words = stripAssignments(raw);
  if (words.length === 0) {
    return null;
  }

  const head = basename(words[0]!);

  // `sudo git push`, `xargs git push`, `sh -c "git push"` — the real command
  // is either the rest of the words or inside a quoted argument.
  if (COMMAND_WRAPPERS.has(head)) {
    const rest = words.slice(1).filter((w) => !w.startsWith("-"));
    const direct = rest.length > 0 ? inspectWords(rest) : null;
    if (direct) {
      return direct;
    }
    for (const inner of words.slice(1)) {
      if (!/\s/.test(inner)) {
        continue;
      }
      const found = inspectCommand(inner);
      if (found) {
        return found;
      }
    }

    return null;
  }

  if (head === "git" || head === "git-push") {
    const subcommand = head === "git-push" ? "push" : gitSubcommand(words);
    if (subcommand === "push") {
      return { level: "pr", what: "git push" };
    }

    return null;
  }

  if (head === "gh") {
    const [group, action] = ghWords(words);
    if (group === "api") {
      // A write through the raw API is a push by another name, and the method
      // is not reliably readable from the argv.
      return { level: "pr", what: "gh api" };
    }
    if (group === "pr" && action === "merge") {
      return { level: "auto_merge", what: "gh pr merge" };
    }
    if (
      (group === "pr" &&
        (action === "create" || action === "ready" || action === "reopen")) ||
      (group === "release" && action === "create")
    ) {
      return { level: "pr", what: `gh ${group} ${action}` };
    }
  }

  return null;
}

/** The highest rung any part of `command` needs, or null when it needs none. */
export function publishingAction(command: string): PublishingAction | null {
  return inspectCommand(command);
}

function inspectCommand(command: string): PublishingAction | null {
  let highest: PublishingAction | null = null;
  for (const segment of splitSegments(command)) {
    const found = inspectWords(tokenize(segment));
    if (found && (!highest || !atLeastAutonomy(highest.level, found.level))) {
      highest = found;
    }
  }

  return highest;
}

/** The automation a session belongs to, and how far that session may go. */
export interface SessionAutonomy {
  automation: Automation;
  autonomy: AutonomyLevel;
}

/**
 * Which automation started this session, if any. A session a human accepted
 * from the inbox is deliberately not here: the human is the authority for it.
 */
export function automationSessionAutonomy(
  sessionId: string,
): SessionAutonomy | null {
  const hostRun = listAutomationRuns().find(
    (run) => run.host_session_id === sessionId,
  );
  if (hostRun) {
    const automation = getAutomation(hostRun.automation_id);
    if (automation) {
      return { automation, autonomy: resolveHostAutonomy(automation) };
    }
  }

  const claim = automationOwningSession(sessionId);
  if (claim) {
    const automation = getAutomation(claim.automation_id);
    if (automation) {
      return { automation, autonomy: sessionAutonomy(automation, sessionId) };
    }
  }

  for (const proposal of listProposals({ status: "auto_started" })) {
    if (proposal.session_id !== sessionId) {
      continue;
    }
    const automation = getAutomation(proposal.automation_id);
    if (automation) {
      return { automation, autonomy: sessionAutonomy(automation, sessionId) };
    }
  }

  return null;
}

function sessionAutonomy(
  automation: Automation,
  sessionId: string,
): AutonomyLevel {
  const repoRoot = appState.sessions.get(sessionId)?.repo_root ?? null;

  return resolvePolicy(automation, repoRoot).autonomy;
}

/**
 * The refusal for one Bash command in one session, or null when the session is
 * not an automation's or the command publishes nothing.
 */
export function automationShellBlock(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown> | null | undefined,
): string | null {
  if (toolName !== "Bash") {
    return null;
  }
  const command = input?.command;
  if (typeof command !== "string" || !command.trim()) {
    return null;
  }
  const action = publishingAction(command);
  if (!action) {
    return null;
  }
  const owner = automationSessionAutonomy(sessionId);
  if (!owner || atLeastAutonomy(owner.autonomy, action.level)) {
    return null;
  }

  return `Refused by Argus: this session was started by the automation "${owner.automation.name}", which runs at autonomy "${owner.autonomy}". \`${action.what}\` needs "${action.level}". Commit your work and stop — a human decides whether it ships.`;
}

/**
 * The file-writing tools. A `propose` run touches nothing, which used to be
 * plan mode's job — but plan mode also prompts, and an unattended run that
 * stops to ask just times out. Denying the tools by name is the same promise
 * without the prompt.
 */
const EDITING_TOOLS = [
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Write",
  "mcp__argus__write_session_file",
];

/** Deny patterns handed to the CLI, so the recognised spellings never run. */
export function automationDisallowedTools(sessionId: string): string[] {
  const owner = automationSessionAutonomy(sessionId);
  if (!owner) {
    return [];
  }
  const rules: string[] = [];
  const deny = (prefix: string) => {
    rules.push(`Bash(${prefix}:*)`, `Bash(${prefix}*)`);
  };

  if (!atLeastAutonomy(owner.autonomy, "draft")) {
    rules.push(...EDITING_TOOLS);
  }
  if (!atLeastAutonomy(owner.autonomy, "pr")) {
    deny("git push");
    deny("gh pr create");
    deny("gh pr ready");
    deny("gh pr reopen");
    deny("gh release create");
    deny("gh api");
  }
  if (!atLeastAutonomy(owner.autonomy, "auto_merge")) {
    deny("gh pr merge");
  }

  return rules;
}

/**
 * The tools a run reports through, allowed outright whatever the mode says —
 * nobody is watching at 07:30 to answer a prompt for the one call the run
 * exists to make. Neither tool touches a file.
 */
const RUN_REPORTING_TOOLS = new Set([
  "mcp__argus__emit_proposal",
  "mcp__argus__emit_report",
]);

/** Whether `sessionId` is an automation run's own neutral host session. */
function isAutomationHostSession(sessionId: string): boolean {
  return appState.sessions.get(sessionId)?.kind === "automation_host";
}

function controlResponse(
  req: Parameters<PermissionPreHook>[0],
  response: Record<string, unknown>,
): void {
  const requestId =
    (req.rawRequest as { request_id?: string } | undefined)?.request_id ?? "";
  req.approveRaw(
    JSON.stringify({
      type: "control_response",
      response: { subtype: "success", request_id: requestId, response },
    }),
  );
}

/**
 * The pre-hook Argus installs on every agent. Returns `handled` after writing
 * a `deny` control response — the CLI never gets the chance to run it, and no
 * permission mode changes that, because the decision is made before the mode
 * is consulted. The same path allows a run's reporting tools, so an unattended
 * run never blocks on a prompt.
 */
export function automationPermissionPreHook(
  sessionId: string,
): PermissionPreHook {
  return (req) => {
    if (
      RUN_REPORTING_TOOLS.has(req.toolName) &&
      isAutomationHostSession(sessionId)
    ) {
      controlResponse(req, { behavior: "allow", updatedInput: req.input });

      return { kind: "handled" };
    }

    const message = automationShellBlock(sessionId, req.toolName, req.input);
    if (!message) {
      return null;
    }
    controlResponse(req, { behavior: "deny", message });

    return { kind: "handled" };
  };
}
