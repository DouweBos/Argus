/**
 * One-shot LLM call that fills in a project's PR template using the
 * session's commit history, description, and branch diff. Used by the
 * "Auto-fill" button in the Open Pull Request dialog.
 */

import { appState } from "../../state";
import { runClaudePrint } from "../llm/runners/claudeCode/oneShot";
import { git } from "./git";
import { readPullRequestTemplate } from "./pullRequest";
import { getSessionBranchDiff } from "./sessionOps";

const MAX_DIFF_CHARS = 60_000;

interface AutofillParams {
  sessionId: string;
  title: string;
  baseBranch: string;
}

/**
 * Build a user prompt that asks Claude to fill in the project's PR template
 * based on the session's commits and diff. Returns the filled body, or
 * `null` when the call fails (timeout, missing template, no Claude CLI).
 */
export async function autofillPullRequestBody(
  params: AutofillParams,
): Promise<string | null> {
  const { sessionId, title, baseBranch } = params;
  const ws = appState.sessions.get(sessionId);
  if (!ws) {
    throw `Session not found: ${sessionId}`;
  }

  const template = readPullRequestTemplate(ws.repo_root);

  let commits = "";
  try {
    commits = (
      await git(ws.path, [
        "log",
        `${baseBranch}..HEAD`,
        "--pretty=format:- %s%n%b",
      ])
    ).trim();
  } catch {
    commits = "";
  }

  let diff = await getSessionBranchDiff(sessionId);
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }

  const sessionDescription = ws.description?.trim() ?? "";

  const sections: string[] = [];
  sections.push(
    template
      ? `Fill in the pull-request template below for this branch. Replace placeholder text and check off any checklist items that the changes complete. Keep the template's structure (headings, lists, formatting). Do not add a wrapping code block. Do not add any commentary outside the template — output ONLY the filled-in markdown body.`
      : `Write a concise pull-request description for this branch. Use markdown. Start with a "## Summary" section (2–4 bullets) and a "## Changes" section listing the notable changes. Output ONLY the markdown body.`,
  );

  sections.push(`PR title: ${title}`);
  sections.push(`Base branch: ${baseBranch}`);
  sections.push(`Head branch: ${ws.branch}`);

  if (sessionDescription) {
    sections.push(
      `Session description / original task:\n${sessionDescription}`,
    );
  }

  if (template) {
    sections.push(`---\nTemplate to fill in:\n\n${template}`);
  }

  if (commits) {
    sections.push(`---\nCommits on this branch:\n\n${commits}`);
  }

  if (diff) {
    sections.push(
      `---\nBranch diff vs ${baseBranch}${truncated ? " (truncated)" : ""}:\n\n${diff}`,
    );
  }

  const prompt = sections.join("\n\n");

  const systemPrompt = template
    ? "You write concise, accurate pull-request descriptions by filling in the project's PR template. You preserve the template's structure exactly and never wrap your output in a code block. Output only the filled-in markdown body."
    : "You write concise, accurate pull-request descriptions in markdown. Output only the markdown body, no code fences.";

  const result = await runClaudePrint({
    prompt,
    source: "pr-autofill",
    cwd: ws.path,
    timeoutMs: 120_000,
    systemPrompt,
    model: "sonnet",
  });

  return stripCodeFence(result);
}

/**
 * Some runs come back wrapped in ```markdown fences despite the system
 * prompt asking otherwise — strip a single outer fence so the textarea
 * shows plain markdown.
 */
function stripCodeFence(value: string | null): string | null {
  if (!value) {
    return value;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```$/);

  return match ? match[1] : trimmed;
}
