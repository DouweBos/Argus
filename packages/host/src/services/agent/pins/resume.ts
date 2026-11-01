/**
 * Bring pinned chats back when the host starts: idle (nothing is sent), on
 * their own agent id, conversation, runner, model, mode and effort.
 */

import type { AgentInfo } from "../models";
import type { PinnedChat } from "./store";
import type { Session } from "../../session/models";
import { existsSync } from "node:fs";
import { addHostEventSink } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { appState } from "../../../state";
import { getMcpPort } from "../../mcp/server";
import { listSessions } from "../../session/manager";
import { isOnMissingVolume } from "../../session/volumeAvailability";
import { capture as telemetryCapture } from "../../telemetry/telemetry";
import { launchAgent, setAgentEffort } from "../agentService";
import { setConversationTitle } from "../conversation/actions";
import { liveConversation } from "../conversation/live";
import { dropPinsForSession } from "./pins";
import { listPins, removePin } from "./store";

/** Between spawns, so a dozen pins don't start a dozen CLIs at once. */
const STAGGER_MS = 750;
/** How long boot waits for the MCP server before resuming without it. */
const MCP_WAIT_MS = 10_000;

export interface ResumeDeps {
  launch: (opts: Parameters<typeof launchAgent>[0]) => Promise<AgentInfo>;
  setEffort: (agentId: string, level: string) => Promise<void>;
  /** The pin's session once its project is loaded, or null when gone. */
  findSession: (pin: PinnedChat) => Promise<Session | null>;
  /** Waits for whatever spawns need first (the MCP server). */
  ready: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  notify: (title: string, body: string) => void;
}

export interface ResumeSummary {
  resumed: number;
  /** Unpinned: its session or worktree is gone. */
  missing: number;
  /** Kept pinned: its drive is unplugged, or the spawn failed. */
  skipped: number;
  failed: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitForMcp(): Promise<void> {
  const deadline = Date.now() + MCP_WAIT_MS;
  while (!getMcpPort() && Date.now() < deadline) {
    await sleep(200);
  }
}

const listedRoots = new Set<string>();

async function findSession(pin: PinnedChat): Promise<Session | null> {
  if (!appState.sessions.has(pin.sessionId) && !listedRoots.has(pin.repoRoot)) {
    listedRoots.add(pin.repoRoot);
    try {
      await listSessions(pin.repoRoot);
    } catch (e) {
      warn(`[pins] couldn't list sessions of a pinned chat: ${String(e)}`);
    }
  }

  return appState.sessions.get(pin.sessionId) ?? null;
}

export const defaultResumeDeps: ResumeDeps = {
  launch: launchAgent,
  setEffort: setAgentEffort,
  findSession,
  ready: waitForMcp,
  sleep,
  notify: (title, body) => hostPlatform().notify({ title, body }),
};

type Outcome = "failed" | "missing" | "resumed" | "skipped";

async function resumeOne(pin: PinnedChat, deps: ResumeDeps): Promise<Outcome> {
  if (appState.agents.has(pin.agentId)) {
    return "skipped";
  }
  if (isOnMissingVolume(pin.repoRoot)) {
    return "skipped";
  }
  const session = await deps.findSession(pin);
  if (session?.availability === "unavailable") {
    return "skipped";
  }
  if (!session?.path || !existsSync(session.path)) {
    removePin(pin.agentId);
    deps.notify(
      "Pinned chat unpinned",
      `${pin.title ?? "A pinned chat"} couldn't come back: its session is gone.`,
    );
    info(`[pins] ${pin.agentId}: session gone, unpinned`);

    return "missing";
  }
  try {
    await deps.launch({
      sessionId: pin.sessionId,
      model: pin.model,
      permissionMode: pin.permissionMode,
      resumeSessionId: pin.runnerSessionId,
      agentId: pin.agentId,
      runnerId: pin.runnerId,
      // A warm spare has its own id; a pin comes back under the one it had.
      fresh: true,
    });
  } catch (e) {
    warn(`[pins] ${pin.agentId}: resume failed: ${String(e)}`);

    return "failed";
  }
  if (pin.effort) {
    await deps.setEffort(pin.agentId, pin.effort).catch((e: unknown) => {
      warn(`[pins] ${pin.agentId}: effort not restored: ${String(e)}`);
    });
  }
  if (pin.title && !liveConversation(pin.agentId)?.title) {
    try {
      setConversationTitle(pin.agentId, pin.title);
    } catch {
      // A title is cosmetic.
    }
  }
  info(`[pins] ${pin.agentId}: resumed`);

  return "resumed";
}

/** Resume every pinned chat, one after another. */
export async function resumePinnedChats(
  deps: ResumeDeps = defaultResumeDeps,
): Promise<ResumeSummary> {
  const summary: ResumeSummary = {
    resumed: 0,
    missing: 0,
    skipped: 0,
    failed: 0,
  };
  const pins = listPins();
  if (pins.length === 0) {
    return summary;
  }
  await deps.ready();
  for (const [i, pin] of pins.entries()) {
    if (i > 0) {
      await deps.sleep(STAGGER_MS);
    }
    summary[await resumeOne(pin, deps)] += 1;
  }
  telemetryCapture("agents_auto_resumed", {
    pinned_count: pins.length,
    resumed_count: summary.resumed,
    missing_count: summary.missing,
    failed_count: summary.failed,
  });
  info(
    `[pins] resumed ${summary.resumed}/${pins.length} pinned chat(s); ${summary.missing} gone, ${summary.failed} failed`,
  );

  return summary;
}

/** Boot hook: drop pins with their session, then resume the rest. */
export function startPinnedChats(): void {
  addHostEventSink((channel, args) => {
    if (channel === "session:deleted" && typeof args[0] === "string") {
      dropPinsForSession(args[0]);
    }
  });
  resumePinnedChats().catch((e: unknown) => {
    warn(`[pins] resuming pinned chats failed: ${String(e)}`);
  });
}
