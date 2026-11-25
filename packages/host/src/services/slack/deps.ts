/**
 * What the Slack bot needs from the rest of the host, as one seam: the real
 * wiring is in `./wiring`, tests pass fakes and a mocked Slack.
 */

import type { SlackApi } from "./api";
import type { SessionLinks } from "./blocks";
import type { SlackConfig, SlackIdentity } from "./store";
import type { SlackThread, SlackThreadStore } from "./threads";
import type { ImageAttachment } from "@argus/remote-protocol";

export type MessageKind = "dm" | "mention" | "thread_reply";

export type MessageOutcome =
  | "asked_project"
  | "claimed"
  | "continued"
  | "refused"
  | "started";

export interface SlackTelemetry {
  messageHandled: (props: {
    kind: MessageKind;
    outcome: MessageOutcome;
    has_images: boolean;
  }) => void;
  permissionAnswered: (decision: "allow" | "deny") => void;
}

export interface PendingPrompt {
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface SlackBotDeps {
  api: Pick<
    SlackApi,
    "download" | "postMessage" | "updateMessage" | "userName"
  >;
  threads: SlackThreadStore;
  config: () => SlackConfig;
  updateConfig: (fn: (config: SlackConfig) => SlackConfig) => SlackConfig;
  identity: () => SlackIdentity | null;
  /** Registered projects, by repo root. */
  projects: () => string[];
  /**
   * New session in `repoRoot` with an agent on `prompt`. Resolves with the
   * session at once; `agentReady` once its agent took the prompt (null if it
   * couldn't start).
   */
  startSession: (
    repoRoot: string,
    prompt: string,
    images: ImageAttachment[],
  ) => Promise<{ sessionId: string; agentReady: Promise<string | null> }>;
  /**
   * Hand a follow-up to the thread's session: its live agent, or a new one
   * resuming the conversation. Null when the session is gone.
   */
  continueSession: (
    thread: SlackThread,
    text: string,
    images: ImageAttachment[],
    author: string | null,
  ) => Promise<{ agentId: string } | null>;
  /**
   * The teammate a handle names, when teammates may answer mentions; null
   * otherwise, and the message goes to a project session as usual.
   */
  teammateByHandle?: (handle: string) => { id: string; name: string } | null;
  /** A fresh conversation with the teammate, its agent ready for a message. */
  startTeammate?: (
    teammateId: string,
  ) => Promise<{ sessionId: string; agentId: string; threadId: string }>;
  /** Pick a teammate's stopped conversation back up; null when it is gone. */
  resumeTeammate?: (
    threadId: string,
    author: string | null,
  ) => Promise<{ agentId: string } | null>;
  /** When the agent's spent usage limit resets, epoch ms, if it hit one. */
  limitResetAt?: (agentId: string) => number | null;
  pendingPrompt: (agentId: string, toolUseId: string) => PendingPrompt | null;
  respondToPermission: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
  ) => void;
  /** The runner's conversation id for resuming after the agent is gone. */
  resumeRef: (agentId: string) => string | null;
  links: (sessionId: string, agentId: string | null) => SessionLinks;
  telemetry: SlackTelemetry;
  /** Every human channel message, for Slack-triggered automations. */
  onChannelMessage?: (message: {
    channel: string;
    user: string;
    text: string;
    ts: string;
    threadTs: string | null;
  }) => void;
  now?: () => number;
}
