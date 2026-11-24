/**
 * A fake Slack and a fake host for the bot's tests. Nothing here talks to
 * Slack: every Web API call is recorded on `calls`.
 */

import type { SlackBlock } from "./api";
import type { SlackBotDeps } from "./deps";
import type { SlackConfig, SlackIdentity } from "./store";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SlackThreadStore } from "./threads";

export interface Posted {
  kind: "post" | "update";
  channel: string;
  threadTs?: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
}

export const BOT_USER = "UBOT";
export const OWNER = "UOWNER";
export const STRANGER = "USTRANGER";

export function tempFile(name: string): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "argus-slack-")),
    name,
  );
}

/** `vi.fn`, passed in: this kit isn't a test file, so it can't import vitest. */
type Spy = <T extends (...args: never[]) => unknown>(impl?: T) => T;

export function fakeSlack(spy: Spy, overrides: Partial<SlackConfig> = {}) {
  const calls: Posted[] = [];
  let seq = 0;
  let config: SlackConfig = {
    defaultProject: null,
    mappings: [],
    allowedUsers: [],
    owner: { user_id: OWNER, name: "Owner" },
    claimCode: null,
    ...overrides,
  };
  const identity: SlackIdentity = {
    teamId: "T1",
    workspace: "Acme",
    botUserId: BOT_USER,
    botName: "argus",
  };
  const threads = new SlackThreadStore(() => file);
  const file = tempFile("threads.json");
  let nextSession = 0;
  const started: { repoRoot: string; prompt: string; images: number }[] = [];
  const continued: {
    text: string;
    author: string | null;
    images: number;
  }[] = [];
  const pending = new Map<
    string,
    { toolName: string; toolInput: Record<string, unknown> }
  >();

  const deps: SlackBotDeps = {
    api: {
      postMessage: spy(async (m) => {
        const ts = `9.${++seq}`;
        calls.push({
          kind: "post",
          channel: m.channel,
          threadTs: m.threadTs,
          ts,
          text: m.text,
          blocks: m.blocks,
        });

        return { channel: m.channel, ts };
      }),
      updateMessage: spy(async (m) => {
        calls.push({
          kind: "update",
          channel: m.channel,
          ts: m.ts,
          text: m.text,
          blocks: m.blocks,
        });
      }),
      download: spy(async () => Buffer.from("png-bytes")),
      userName: spy(async (id: string) => (id === OWNER ? "Owner" : "Someone")),
    },
    threads,
    config: () => config,
    updateConfig: (fn) => {
      config = fn(config);

      return config;
    },
    identity: () => identity,
    projects: () => ["/work/web", "/work/ios"],
    startSession: spy(async (repoRoot: string, prompt: string, images) => {
      started.push({ repoRoot, prompt, images: images.length });

      return {
        sessionId: `s${++nextSession}`,
        agentReady: Promise.resolve(`a${nextSession}`),
      };
    }),
    continueSession: spy(async (thread, text, images, author) => {
      continued.push({ text, author, images: images.length });

      return thread.agentId
        ? { agentId: thread.agentId }
        : { agentId: "a-resumed" };
    }),
    pendingPrompt: (agentId, toolUseId) =>
      pending.get(`${agentId}:${toolUseId}`) ?? null,
    respondToPermission: spy((agentId: string, toolUseId: string) => {
      pending.delete(`${agentId}:${toolUseId}`);
    }),
    resumeRef: () => "conv-1",
    links: (sessionId, agentId) => ({
      app: `argus://sessions/${sessionId}/agents/${agentId ?? ""}`,
      web: null,
    }),
    telemetry: {
      messageHandled: spy<SlackBotDeps["telemetry"]["messageHandled"]>(),
      permissionAnswered:
        spy<SlackBotDeps["telemetry"]["permissionAnswered"]>(),
    },
    onChannelMessage: spy<NonNullable<SlackBotDeps["onChannelMessage"]>>(),
  };

  return {
    deps,
    calls,
    started,
    continued,
    pending,
    threads,
    config: () => config,
    posts: () => calls.filter((c) => c.kind === "post"),
    updates: () => calls.filter((c) => c.kind === "update"),
  };
}

export function mention(
  text: string,
  opts: {
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    files?: unknown[];
  } = {},
) {
  return {
    type: "events_api",
    envelope_id: "e1",
    payload: {
      event: {
        type: "app_mention",
        user: opts.user ?? OWNER,
        text: `<@${BOT_USER}> ${text}`,
        ts: opts.ts ?? "1.1",
        thread_ts: opts.thread_ts,
        channel: opts.channel ?? "CWEB",
        files: opts.files,
      },
    },
  };
}

export function dm(
  text: string,
  opts: { user?: string; ts?: string; thread_ts?: string } = {},
) {
  return {
    type: "events_api",
    envelope_id: "e2",
    payload: {
      event: {
        type: "message",
        channel_type: "im",
        user: opts.user ?? OWNER,
        text,
        ts: opts.ts ?? "2.1",
        thread_ts: opts.thread_ts,
        channel: "DOWNER",
      },
    },
  };
}

export function channelMessage(
  text: string,
  opts: {
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  } = {},
) {
  return {
    type: "events_api",
    envelope_id: "e3",
    payload: {
      event: {
        type: "message",
        channel_type: "channel",
        user: opts.user ?? OWNER,
        text,
        ts: opts.ts ?? "3.1",
        thread_ts: opts.thread_ts,
        channel: opts.channel ?? "CWEB",
      },
    },
  };
}

export function click(opts: {
  actionId: string;
  value: string;
  user?: string;
  channel?: string;
  messageTs: string;
  threadTs: string;
}) {
  return {
    type: "interactive",
    envelope_id: "e4",
    payload: {
      type: "block_actions",
      user: { id: opts.user ?? OWNER },
      channel: { id: opts.channel ?? "CWEB" },
      message: { ts: opts.messageTs, thread_ts: opts.threadTs },
      actions: [{ action_id: opts.actionId, value: opts.value }],
    },
  };
}
