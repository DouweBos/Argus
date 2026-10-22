import type { ImageAttachment } from "./ipc";
import type { CanonicalPermissionMode } from "./permissionModes";
import { setLinkedProjects } from "../stores/conversationStore";
import { selectSession, setPendingPrompt } from "../stores/sessionStore";
import { sendUserMessageToAgent, startAgentInSession } from "./agentLifecycle";
import { buildLinkedProjectsPreamble } from "./linkedProjectsPreamble";
import { createSessionInProject } from "./projectsService";

/** Everything the start composer collected for the first agent. */
export interface StartRequest {
  images: ImageAttachment[];
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

/** Start the agent right here, in a session that already exists. */
export async function startInSession(
  sessionId: string,
  request: StartRequest,
): Promise<void> {
  const { images, linkedProjects, permissionMode, prompt, runnerId } = request;
  const info = await startAgentInSession(sessionId, {
    focus: true,
    model: explicitModel(request.model),
    permissionMode,
    runnerId,
  });
  if (linkedProjects.length > 0) {
    setLinkedProjects(info.agent_id, linkedProjects);
  }
  const text = prompt.trim() || "(see attached images)";
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
 * starts once the session is ready (`initPendingSessionPrompts`).
 */
export async function startInNewWorktree(
  repoRoot: string,
  baseBranch: string | undefined,
  request: StartRequest,
): Promise<void> {
  const prompt = request.prompt.trim();
  const model = explicitModel(request.model);
  const session = await createSessionInProject(
    repoRoot,
    "",
    prompt,
    false,
    baseBranch,
    { runner: request.runnerId, model: model ?? null },
  );
  setPendingPrompt(session.id, prompt, {
    images: request.images,
    linkedProjects: request.linkedProjects,
    model,
    permissionMode: request.permissionMode,
  });
  selectSession(session.id, "home");
}
