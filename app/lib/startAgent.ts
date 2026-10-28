import type { ImageAttachment } from "./ipc";
import type { CanonicalPermissionMode } from "./permissionModes";
import type { LinearIssueContext, LinkedIssue } from "./types";
import { setLinkedProjects } from "../stores/conversationStore";
import { selectSession, setPendingPrompt } from "../stores/sessionStore";
import { sendUserMessageToAgent, startAgentInSession } from "./agentLifecycle";
import { buildLinkedProjectsPreamble } from "./linkedProjectsPreamble";
import { createSessionInProject } from "./projectsService";

/** Everything the start composer collected for the first agent. */
export interface StartRequest {
  images: ImageAttachment[];
  /** Linear issues to work on — one worktree and agent each. */
  issues: LinearIssueContext[];
  linkedProjects: string[];
  /** `"default"` lets the runner pick. */
  model: string;
  permissionMode: CanonicalPermissionMode;
  prompt: string;
  runnerId: string;
}

function explicitModel(model: string): string | undefined {
  return model && model !== "default" ? model : undefined;
}

const ISSUE_ONLY_PROMPT = "Work on this issue.";

/** The issue context first, then what the user typed (or a default ask). */
export function promptWithIssues(
  issues: LinearIssueContext[],
  prompt: string,
): string {
  const text = prompt.trim();
  if (issues.length === 0) {
    return text;
  }

  return [...issues.map((i) => i.context), text || ISSUE_ONLY_PROMPT].join(
    "\n\n",
  );
}

function linkedIssue({ issue }: LinearIssueContext): LinkedIssue {
  return {
    source: "linear",
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
  };
}

/** Start the agent right here, in a session that already exists. */
export async function startInSession(
  sessionId: string,
  request: StartRequest,
): Promise<void> {
  const { issues, linkedProjects, permissionMode, prompt, runnerId } = request;
  const images = [...request.images, ...issues.flatMap((i) => i.images)];
  const info = await startAgentInSession(sessionId, {
    focus: true,
    model: explicitModel(request.model),
    permissionMode,
    runnerId,
  });
  if (linkedProjects.length > 0) {
    setLinkedProjects(info.agent_id, linkedProjects);
  }
  const text = promptWithIssues(issues, prompt) || "(see attached images)";
  const message = buildLinkedProjectsPreamble(linkedProjects, text);
  // The transcript (and the title made from it) shows what the user typed.
  await sendUserMessageToAgent(
    info.agent_id,
    message,
    images.length > 0 ? images : undefined,
    message === text ? undefined : text,
  );
}

/**
 * Start the agent in a fresh worktree off `baseBranch`. The host names the
 * branch from the prompt and builds the worktree in the background; the agent
 * starts once the session is ready (`initPendingSessionPrompts`). With issues,
 * each gets its own worktree on Linear's branch name.
 */
export async function startInNewWorktree(
  repoRoot: string,
  baseBranch: string | undefined,
  request: StartRequest,
): Promise<void> {
  const model = explicitModel(request.model);
  const llm = { runner: request.runnerId, model: model ?? null };
  const pending = {
    linkedProjects: request.linkedProjects,
    model,
    permissionMode: request.permissionMode,
  };
  if (request.issues.length === 0) {
    const prompt = request.prompt.trim();
    const session = await createSessionInProject(
      repoRoot,
      "",
      prompt,
      false,
      baseBranch,
      llm,
    );
    setPendingPrompt(session.id, prompt, {
      ...pending,
      images: request.images,
    });
    selectSession(session.id, "home");

    return;
  }
  const sessions = await Promise.all(
    request.issues.map(async (context) => {
      const { issue } = context;
      const session = await createSessionInProject(
        repoRoot,
        issue.branchName,
        `${issue.identifier} ${issue.title}`,
        false,
        baseBranch,
        llm,
        linkedIssue(context),
      );
      setPendingPrompt(
        session.id,
        promptWithIssues([context], request.prompt),
        {
          ...pending,
          images: [...request.images, ...context.images],
        },
      );

      return session;
    }),
  );
  selectSession(sessions[0].id, "home");
}
