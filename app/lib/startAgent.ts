import type { ImageAttachment } from "./ipc";
import type { CanonicalPermissionMode } from "./permissionModes";
import type { DesignRef, LinearIssueContext, LinkedIssue } from "./types";
import { startPrompt } from "@argus/remote-protocol";
import { setLinkedProjects } from "../stores/conversationStore";
import { selectSession, setPendingPrompt } from "../stores/sessionStore";
import { sendUserMessageToAgent, startAgentInSession } from "./agentLifecycle";
import { setSessionDesignRefs } from "./ipc";
import { buildLinkedProjectsPreamble } from "./linkedProjectsPreamble";
import { createSessionInProject } from "./projectsService";

/** Everything the start composer collected for the first agent. */
export interface StartRequest {
  /** Figma frames to match; one scoped to an issue only goes to that issue's agent. */
  designs: { issueId: string | null; ref: DesignRef }[];
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

type DraftDesign = StartRequest["designs"][number];

/** Issue context, then the designs to match, then what the user typed (or a default ask). */
function startPromptFor(
  issues: LinearIssueContext[],
  designs: DesignRef[],
  prompt: string,
): string {
  return startPrompt(
    issues.map((i) => i.context),
    designs,
    prompt,
  );
}

/** The designs one issue's agent gets: its own plus the unscoped ones. */
function designsFor(
  designs: DraftDesign[],
  issueId: string | null,
): DesignRef[] {
  return designs
    .filter((d) => d.issueId === null || d.issueId === issueId)
    .map((d) => d.ref);
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
  const designs = request.designs.map((d) => d.ref);
  if (designs.length > 0) {
    await setSessionDesignRefs(sessionId, designs);
  }
  const text =
    startPromptFor(issues, designs, prompt) || "(see attached images)";
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
    const designs = designsFor(request.designs, null);
    const session = await createSessionInProject(
      repoRoot,
      "",
      request.prompt.trim(),
      false,
      baseBranch,
      llm,
      undefined,
      designs,
    );
    setPendingPrompt(session.id, startPromptFor([], designs, request.prompt), {
      ...pending,
      images: request.images,
    });
    selectSession(session.id, "home");

    return;
  }
  const sessions = await Promise.all(
    request.issues.map(async (context) => {
      const { issue } = context;
      const designs = designsFor(request.designs, issue.id);
      const session = await createSessionInProject(
        repoRoot,
        issue.branchName,
        `${issue.identifier} ${issue.title}`,
        false,
        baseBranch,
        llm,
        linkedIssue(context),
        designs,
      );
      setPendingPrompt(
        session.id,
        startPromptFor([context], designs, request.prompt),
        { ...pending, images: [...request.images, ...context.images] },
      );

      return session;
    }),
  );
  selectSession(sessions[0].id, "home");
}
