/**
 * One-shot LLM call that drafts a PR's title and fills in the project's PR
 * template using the session's commit history, description, and branch diff,
 * in the configured message style. Used by "Fill in with Claude".
 */

import { appState } from "../../state";
import { runClaudePrint } from "../llm/runners/claudeCode/oneShot";
import { capture } from "../telemetry/telemetry";
import { parseCommitMessage } from "./commitDraft";
import { git } from "./git";
import { resolveMessageStyle } from "./messageStyle";
import { readPullRequestTemplate } from "./pullRequest";
import { getSessionBranchDiff } from "./sessionOps";

const MAX_DIFF_CHARS = 60_000;

interface AutofillParams {
  sessionId: string;
  title: string;
  baseBranch: string;
}

/** Openings of the two prompts, for the CLI chat importer to recognise. */
export const PR_TEMPLATE_PROMPT =
  "Fill in the pull-request template below for this branch.";
export const PR_DESCRIPTION_PROMPT =
  "Write a concise pull-request description for this branch.";

export interface PullRequestDraft {
  title: string;
  body: string;
}

/** The drafted body alone, for callers that keep their own title. */
export async function autofillPullRequestBody(
  params: AutofillParams,
): Promise<string | null> {
  return (await autofillPullRequest(params))?.body ?? null;
}

/**
 * Asks Claude for a title and the PR template filled in from the session's
 * commits and diff. Returns `null` when the call fails (timeout, no Claude CLI).
 */
export async function autofillPullRequest(
  params: AutofillParams,
): Promise<PullRequestDraft | null> {
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
  const style = await resolveMessageStyle(ws.path);

  const sections: string[] = [];
  sections.push(
    template
      ? `${PR_TEMPLATE_PROMPT} Replace placeholder text and check off any checklist items that the changes complete. Keep the template's structure (headings, lists, formatting). Do not add a wrapping code block. Do not add any commentary outside the template.`
      : `${PR_DESCRIPTION_PROMPT} Use markdown. Start with a "## Summary" section (2–4 bullets) and a "## Changes" section listing the notable changes.`,
  );
  sections.push(
    "Output the pull request's title on the first line, then a blank line, then ONLY the markdown body.",
  );
  sections.push(style.guidance);

  sections.push(`Working title: ${title}`);
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
    ? "You write concise, accurate pull requests by filling in the project's PR template. You preserve the template's structure exactly and never wrap your output in a code block. Output only the title line, a blank line and the filled-in markdown body."
    : "You write concise, accurate pull requests in markdown. Output only the title line, a blank line and the markdown body, no code fences.";

  const result = await runClaudePrint({
    prompt,
    source: "pr-autofill",
    cwd: ws.path,
    timeoutMs: 120_000,
    systemPrompt,
    model: "sonnet",
  });

  const draft = result ? parseCommitMessage(result) : null;
  capture("pull_request_drafted", {
    style: style.mode,
    has_template: template !== null,
    success: draft !== null,
  });
  if (!draft) {
    return null;
  }

  return {
    title: draft.subject.replace(/^(#+\s*|title:\s*)/i, ""),
    body: stripCodeFence(draft.body) ?? "",
  };
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
