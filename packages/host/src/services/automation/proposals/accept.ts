/**
 * Accepting a proposal: turn it into a worktree session with an agent already
 * working on it.
 *
 * This is the landing for both paths. A human pressing Start in the inbox and
 * the autonomy gate in `automation/autoStart.ts` come through here; only the
 * resulting status and the brief differ. The gate itself lives upstream — by
 * the time we are here the decision has been made.
 */

import type { Proposal } from "./models";
import type { Session } from "../../session/models";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../../state";
import { sendAgentMessage, startAgent } from "../../agent/agentService";
import { ensureRepoRegistered } from "../../mcp/projects";
import { createSession } from "../../session/manager";
import { recordAutomationSession } from "../ownedSessions";
import { requireProposal, updateProposal } from "./manager";

/** Setup pipelines can install dependencies, so give them room. */
const SESSION_READY_TIMEOUT_MS = 15 * 60 * 1000;

export interface AcceptProposalResult {
  proposal: Proposal;
  session_id: string;
  agent_id: string;
}

export interface AcceptProposalOptions {
  /** `auto_started` when the autonomy gate opened it, not a human. */
  status?: "accepted" | "auto_started";
}

export async function acceptProposal(
  proposalId: string,
  options: AcceptProposalOptions = {},
): Promise<AcceptProposalResult> {
  const status = options.status ?? "accepted";
  const proposal = requireProposal(proposalId);
  if (proposal.session_id) {
    throw `Proposal already started in session ${proposal.session_id}`;
  }
  if (proposal.cta && proposal.cta.kind !== "start_session") {
    throw `This proposal asks you to "${proposal.cta.label}", not to start a session.`;
  }
  const repoRoot = proposal.repo_root;
  if (!repoRoot) {
    throw "This proposal has no project to work in.";
  }

  ensureRepoRegistered(repoRoot);

  const session = await createSession(
    repoRoot,
    proposal.title || "Proposal",
    proposal.summary,
    false,
    undefined,
    undefined,
    { awaitWorktreeReady: true },
  );
  emitSessionCreated(session);

  // Claim the session before its agent can run: the shell guard resolves the
  // automation through this link, so a gap here is a window in which an
  // auto-started agent is unconstrained.
  if (status === "auto_started") {
    recordAutomationSession(
      proposal.automation_id,
      proposal.run_id,
      session.id,
    );
  }
  updateProposal(proposal.id, { session_id: session.id });

  await waitForSessionReady(session.id);

  const prompt = buildPrompt(proposal, status);
  const agent = await startAgent(session.id);

  // Backend-initiated spawns are invisible to the UI without this — the
  // renderer never subscribes to the agent's channels otherwise.
  emitHostEvent("agent:started", {
    agent_id: agent.agent_id,
    session_id: agent.session_id,
    status: agent.status,
    parent_agent_id: agent.parent_agent_id,
    created_at: agent.created_at,
    initial_prompt: prompt,
    model: agent.model,
  });
  sendAgentMessage(agent.agent_id, prompt);

  const updated = updateProposal(proposal.id, {
    status,
    session_id: session.id,
  });
  info(`Proposal ${proposal.id} ${status} into session ${session.id}`);

  return {
    proposal: updated,
    session_id: session.id,
    agent_id: agent.agent_id,
  };
}

function emitSessionCreated(session: Session): void {
  emitHostEvent("session:created", { ...session });
}

async function waitForSessionReady(sessionId: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < SESSION_READY_TIMEOUT_MS) {
    const session = appState.sessions.get(sessionId);
    if (!session) {
      throw `Session ${sessionId} was deleted before it became ready`;
    }
    if (session.status === "ready") {
      return;
    }
    if (typeof session.status !== "string") {
      throw `Session ${sessionId} failed to initialize: ${session.status.error}`;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw `Timed out waiting for session ${sessionId} to become ready`;
}

/** The proposal, restated as the agent's brief. */
function buildPrompt(
  proposal: Proposal,
  status: "accepted" | "auto_started",
): string {
  const lines = [
    `# ${proposal.title}`,
    "",
    proposal.summary,
    "",
    "## Why this was proposed",
    "",
    proposal.rationale,
  ];

  if (proposal.source_ref) {
    lines.push(
      "",
      "## Source",
      "",
      `${proposal.source_ref.external_id} — ${proposal.source_ref.url}`,
    );
  }

  lines.push(
    "",
    "---",
    "",
    status === "auto_started"
      ? "This came from an Argus automation that started it on its own — no human has read it yet. Start by confirming the proposal still matches what the code and the source item actually say; if it does not, stop and say so rather than changing anything."
      : "This came from an Argus automation and a human accepted it. Start by confirming the proposal still matches what the code and the source item actually say; if it does not, say so before changing anything.",
  );

  return lines.join("\n");
}
