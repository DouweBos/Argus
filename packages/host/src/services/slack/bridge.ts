/**
 * An agent's turn, mirrored into its Slack thread: one status message edited
 * as the work moves (throttled, never a message per tool call), the final
 * reply as mrkdwn, and permission prompts as Approve / Deny buttons that stay
 * in step with the Mac and the phone.
 */

import type { SlackBotDeps } from "./deps";
import type { SlackThread } from "./threads";
import { warn } from "@argus/host/logger";
import { permissionActions } from "../notifications/actions";
import {
  permissionAnswered,
  permissionPrompt,
  projectName,
  statusMessage,
} from "./blocks";
import { markdownToMrkdwn, truncateMrkdwn } from "./mrkdwn";
import {
  type Activity,
  activityForStreamLine,
  resultOfStreamLine,
} from "./progress";

/** Slack shows up to 40k, but a long wall in a thread helps nobody. */
export const REPLY_LIMIT = 3500;
const STATUS_THROTTLE_MS = 3000;
const AGENT_CHANNEL = /^agent:([a-z-]+):(.+)$/;

interface Turn {
  activity: Activity;
  shown: Activity | null;
  lastUpdate: number;
  timer: ReturnType<typeof setTimeout> | null;
  result: { text: string; failed: boolean } | null;
}

interface PostedPrompt {
  channel: string;
  ts: string;
  toolName: string;
}

export class ThreadBridge {
  private turns = new Map<string, Turn>();
  private prompts = new Map<string, PostedPrompt>();
  /** Answers given from Slack, so the resolved message can say who. */
  private answeredBy = new Map<string, string>();

  constructor(private readonly deps: SlackBotDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Called for every host event; ignores agents no thread owns. */
  handleHostEvent(channel: string, payload: unknown): void {
    if (channel === "agent:started") {
      this.agentStarted(
        payload as {
          agent_id?: string;
          session_id?: string;
          parent_agent_id?: string | null;
        },
      );

      return;
    }
    const match = AGENT_CHANNEL.exec(channel);
    if (!match) {
      return;
    }
    const [, kind, agentId] = match as unknown as [string, string, string];
    const thread = this.deps.threads.byAgent(agentId);
    if (!thread) {
      return;
    }
    switch (kind) {
      case "event":
        this.streamLine(agentId, payload as string);
        break;
      case "status":
        this.statusChanged(thread, agentId, payload as string);
        break;
      case "permission":
        this.permissionRequested(
          thread,
          agentId,
          payload as {
            tool_use_id: string;
            tool_name: string;
            tool_input: Record<string, unknown>;
          },
        ).catch(() => undefined);
        break;
      case "permission-resolved":
      case "permission-cancel":
        this.permissionResolved(
          agentId,
          payload as { tool_use_id: string; decision?: "allow" | "deny" },
        ).catch(() => undefined);
        break;
    }
  }

  /** A new turn starts: post its status message at the bottom of the thread. */
  async beginTurn(thread: SlackThread): Promise<void> {
    const message = statusMessage({
      activity: thread.agentId ? "thinking" : "starting",
      project: thread.repoRoot ? projectName(thread.repoRoot) : "Argus",
      links: thread.sessionId
        ? this.deps.links(thread.sessionId, thread.agentId)
        : null,
    });
    try {
      const posted = await this.deps.api.postMessage({
        channel: thread.channel,
        threadTs: thread.threadTs,
        ...message,
      });
      this.deps.threads.put(thread.channel, thread.threadTs, {
        statusTs: posted.ts,
      });
    } catch (e) {
      warn(`[slack] couldn't post the status message: ${String(e)}`);
    }
    if (thread.agentId) {
      this.turnFor(thread.agentId).activity = "thinking";
    }
  }

  noteAnswer(agentId: string, toolUseId: string, userId: string): void {
    this.answeredBy.set(`${agentId}:${toolUseId}`, userId);
  }

  private agentStarted(info: {
    agent_id?: string;
    session_id?: string;
    parent_agent_id?: string | null;
  }): void {
    if (!info.agent_id || !info.session_id || info.parent_agent_id) {
      return;
    }
    const thread = this.deps.threads.bySession(info.session_id);
    if (!thread || thread.agentId === info.agent_id) {
      return;
    }
    // A resumed or handed-off agent takes the thread over.
    this.deps.threads.put(thread.channel, thread.threadTs, {
      agentId: info.agent_id,
    });
    this.turnFor(info.agent_id).activity = "thinking";
    this.scheduleStatus(info.agent_id);
  }

  private turnFor(agentId: string): Turn {
    let turn = this.turns.get(agentId);
    if (!turn) {
      turn = {
        activity: "starting",
        shown: null,
        lastUpdate: 0,
        timer: null,
        result: null,
      };
      this.turns.set(agentId, turn);
    }

    return turn;
  }

  private streamLine(agentId: string, line: string): void {
    const turn = this.turnFor(agentId);
    const result = resultOfStreamLine(line);
    if (result) {
      turn.result = result;

      return;
    }
    const activity = activityForStreamLine(line);
    if (activity && activity !== turn.activity) {
      turn.activity = activity;
      this.scheduleStatus(agentId);
    }
  }

  private scheduleStatus(agentId: string): void {
    const turn = this.turnFor(agentId);
    if (turn.timer) {
      return;
    }
    const wait = Math.max(0, turn.lastUpdate + STATUS_THROTTLE_MS - this.now());
    turn.timer = setTimeout(() => {
      turn.timer = null;
      this.showStatus(agentId).catch(() => undefined);
    }, wait);
  }

  private async showStatus(agentId: string): Promise<void> {
    const thread = this.deps.threads.byAgent(agentId);
    const turn = this.turns.get(agentId);
    if (!thread?.statusTs || !thread.sessionId || !turn) {
      return;
    }
    if (turn.shown === turn.activity) {
      return;
    }
    turn.shown = turn.activity;
    turn.lastUpdate = this.now();
    try {
      await this.deps.api.updateMessage({
        channel: thread.channel,
        ts: thread.statusTs,
        ...statusMessage({
          activity: turn.activity,
          project: thread.repoRoot ? projectName(thread.repoRoot) : "Argus",
          links: this.deps.links(thread.sessionId, agentId),
        }),
      });
    } catch (e) {
      warn(`[slack] couldn't update the status message: ${String(e)}`);
    }
  }

  private statusChanged(
    thread: SlackThread,
    agentId: string,
    status: string,
  ): void {
    const turn = this.turnFor(agentId);
    if (status === "running" && turn.activity === "starting") {
      turn.activity = "thinking";
      this.scheduleStatus(agentId);

      return;
    }
    if (status === "idle") {
      if (turn.result) {
        this.finish(thread, agentId, turn).catch(() => undefined);
      }

      return;
    }
    if (status === "stopped" || status === "error") {
      turn.activity = status === "error" ? "failed" : "stopped";
      this.settle(thread, agentId, turn).catch(() => undefined);
    }
  }

  private async finish(
    thread: SlackThread,
    agentId: string,
    turn: Turn,
  ): Promise<void> {
    const result = turn.result!;
    turn.result = null;
    turn.activity = result.failed ? "failed" : "done";
    const links = thread.sessionId
      ? this.deps.links(thread.sessionId, agentId)
      : null;
    let body = result.failed
      ? "The agent stopped with an error. Open it in Argus to see why."
      : "Done.";
    if (result.text.trim()) {
      body = truncateMrkdwn(
        markdownToMrkdwn(result.text),
        REPLY_LIMIT,
        links?.app ?? null,
      );
    }
    try {
      await this.deps.api.postMessage({
        channel: thread.channel,
        threadTs: thread.threadTs,
        text: body,
      });
    } catch (e) {
      warn(`[slack] couldn't post the reply: ${String(e)}`);
    }
    await this.settle(thread, agentId, turn);
  }

  /** The turn is over: final status now, and remember how to resume. */
  private async settle(
    thread: SlackThread,
    agentId: string,
    turn: Turn,
  ): Promise<void> {
    if (turn.timer) {
      clearTimeout(turn.timer);
      turn.timer = null;
    }
    const resumeRef = this.deps.resumeRef(agentId);
    if (resumeRef) {
      this.deps.threads.put(thread.channel, thread.threadTs, { resumeRef });
    }
    await this.showStatus(agentId);
    this.turns.delete(agentId);
  }

  private async permissionRequested(
    thread: SlackThread,
    agentId: string,
    request: {
      tool_use_id: string;
      tool_name: string;
      tool_input: Record<string, unknown>;
    },
  ): Promise<void> {
    const key = `${agentId}:${request.tool_use_id}`;
    if (this.prompts.has(key)) {
      return;
    }
    const answerable = permissionActions(request.tool_name).length > 0;
    const message = permissionPrompt({
      ref: { agentId, toolUseId: request.tool_use_id },
      toolName: request.tool_name,
      toolInput: request.tool_input ?? {},
      answerable,
      links: thread.sessionId
        ? this.deps.links(thread.sessionId, agentId)
        : null,
    });
    const turn = this.turnFor(agentId);
    turn.activity = "waiting";
    this.scheduleStatus(agentId);
    try {
      const posted = await this.deps.api.postMessage({
        channel: thread.channel,
        threadTs: thread.threadTs,
        ...message,
      });
      this.prompts.set(key, {
        channel: posted.channel,
        ts: posted.ts,
        toolName: request.tool_name,
      });
    } catch (e) {
      warn(`[slack] couldn't post the permission prompt: ${String(e)}`);
    }
  }

  private async permissionResolved(
    agentId: string,
    payload: { tool_use_id: string; decision?: "allow" | "deny" },
  ): Promise<void> {
    const key = `${agentId}:${payload.tool_use_id}`;
    const posted = this.prompts.get(key);
    if (!posted) {
      return;
    }
    this.prompts.delete(key);
    const by = this.answeredBy.get(key) ?? null;
    this.answeredBy.delete(key);
    const turn = this.turns.get(agentId);
    if (turn?.activity === "waiting") {
      turn.activity = "thinking";
      this.scheduleStatus(agentId);
    }
    try {
      await this.deps.api.updateMessage({
        channel: posted.channel,
        ts: posted.ts,
        ...(payload.decision
          ? permissionAnswered({
              toolName: posted.toolName,
              decision: payload.decision,
              by,
            })
          : {
              text: `The agent withdrew its request for \`${posted.toolName}\`.`,
              blocks: [],
            }),
      });
    } catch (e) {
      warn(`[slack] couldn't update the permission prompt: ${String(e)}`);
    }
  }

  dispose(): void {
    for (const turn of this.turns.values()) {
      if (turn.timer) {
        clearTimeout(turn.timer);
      }
    }
    this.turns.clear();
    this.prompts.clear();
  }
}
