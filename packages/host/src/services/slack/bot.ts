/**
 * Slack in: mentions, DMs and thread replies become agent work, and the
 * buttons Argus posted come back as answers. Every path checks the sender
 * against the allowlist first; Slack output for the agent's turn is the
 * bridge's job.
 */

import type { MessageKind, SlackBotDeps } from "./deps";
import type { SlackEnvelope } from "./events";
import type { SlackFileRef, SlackThread } from "./threads";
import type { ImageAttachment } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import {
  claimAttempt,
  isAllowed,
  MAX_CLAIM_ATTEMPTS,
  REFUSAL,
  UNCLAIMED,
} from "./access";
import {
  ACTION_ALLOW,
  ACTION_DENY,
  ACTION_PICK_PROJECT,
  ACTION_RESUME,
  parsePermissionValue,
  parseResumeValue,
  pickedProject,
  projectPicker,
  projectToken,
  resumedMessage,
} from "./blocks";
import { ThreadBridge } from "./bridge";
import { parseEnvelope, type SlackAction, type SlackMessage } from "./events";
import {
  routeMessage,
  slackTextToPlain,
  stripBotMention,
  teammateMention,
} from "./routing";
import { newClaimCode } from "./store";

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SEEN_LIMIT = 1000;

export class SlackBot {
  readonly bridge: ThreadBridge;
  private seen = new Set<string>();
  private refused = new Set<string>();
  private claimMisses = 0;

  constructor(private readonly deps: SlackBotDeps) {
    this.bridge = new ThreadBridge(deps);
  }

  /** One Socket Mode envelope. Never throws. */
  async handleEnvelope(envelope: SlackEnvelope): Promise<void> {
    try {
      const parsed = parseEnvelope(
        envelope,
        this.deps.identity()?.botUserId ?? "",
      );
      if (!parsed) {
        return;
      }
      if (parsed.type === "action") {
        await this.handleAction(parsed.action);

        return;
      }
      if (!this.firstSighting(parsed.message)) {
        return;
      }
      if (parsed.type === "channel_message") {
        this.deps.onChannelMessage?.({
          channel: parsed.message.channel,
          user: parsed.message.user,
          text: slackTextToPlain(parsed.message.text),
          ts: parsed.message.ts,
          threadTs: parsed.message.threadTs,
        });
        const thread = parsed.message.threadTs
          ? this.deps.threads.get(
              parsed.message.channel,
              parsed.message.threadTs,
            )
          : null;
        if (!thread) {
          return;
        }
        await this.handleMessage(parsed.message, "thread_reply");

        return;
      }
      const { channel, threadTs } = parsed.message;
      const inOwnThread =
        threadTs !== null && Boolean(this.deps.threads.get(channel, threadTs));
      await this.handleMessage(
        parsed.message,
        parsed.kind === "mention" && inOwnThread ? "thread_reply" : parsed.kind,
      );
    } catch (e) {
      warn(`[slack] handling an event failed: ${String(e)}`);
    }
  }

  /** Slack sends a mention as both `app_mention` and `message`; once is enough. */
  private firstSighting(message: SlackMessage): boolean {
    const key = `${message.channel}:${message.ts}`;
    if (this.seen.has(key)) {
      return false;
    }
    this.seen.add(key);
    if (this.seen.size > SEEN_LIMIT) {
      this.seen.delete(this.seen.values().next().value as string);
    }

    return true;
  }

  private async reply(
    message: { channel: string; threadTs: string },
    text: string,
  ): Promise<void> {
    try {
      await this.deps.api.postMessage({ ...message, text });
    } catch (e) {
      warn(`[slack] couldn't reply: ${String(e)}`);
    }
  }

  async handleMessage(message: SlackMessage, kind: MessageKind): Promise<void> {
    const root = message.threadTs ?? message.ts;
    const where = { channel: message.channel, threadTs: root };
    const hasImages = message.files.some((f) => IMAGE_TYPES.has(f.mimetype));
    const track = (
      outcome: Parameters<
        SlackBotDeps["telemetry"]["messageHandled"]
      >[0]["outcome"],
    ): void =>
      this.deps.telemetry.messageHandled({
        kind,
        outcome,
        has_images: hasImages,
      });

    if (message.isDm && (await this.tryClaim(message, where))) {
      track("claimed");

      return;
    }
    const config = this.deps.config();
    if (!isAllowed(config, message.user)) {
      // Once per thread: a refusal on every reply would be noise.
      const key = `${message.channel}:${root}`;
      if (!this.refused.has(key)) {
        this.refused.add(key);
        if (this.refused.size > SEEN_LIMIT) {
          this.refused.delete(this.refused.values().next().value as string);
        }
        await this.reply(where, config.owner ? REFUSAL : UNCLAIMED);
      }
      track("refused");

      return;
    }

    const botUserId = this.deps.identity()?.botUserId ?? "";
    const text = slackTextToPlain(stripBotMention(message.text, botUserId));
    if (!text && message.files.length === 0) {
      await this.reply(
        where,
        "What should I work on? Mention me with a request.",
      );

      return;
    }

    const thread = this.deps.threads.get(message.channel, root);
    if (!thread?.sessionId && !thread?.teammate) {
      const mention = teammateMention(text);
      const teammate = mention
        ? (this.deps.teammateByHandle?.(mention.handle) ?? null)
        : null;
      if (mention && teammate) {
        await this.startTeammate(
          where,
          message,
          teammate,
          mention.rest || text,
        );
        track("started");

        return;
      }
    }
    const route = routeMessage({
      config,
      channel: message.channel,
      isDm: message.isDm,
      thread,
      projects: this.deps.projects(),
    });
    switch (route.kind) {
      case "continue": {
        const sent = await this.continueThread(route.thread, message, text);
        if (sent) {
          track("continued");

          return;
        }
        // The session was deleted: start over in the same project.
        if (
          route.thread.repoRoot &&
          this.deps.projects().includes(route.thread.repoRoot)
        ) {
          await this.reply(
            where,
            "That session is gone, so I'm starting a new one.",
          );
          await this.start(where, message, text, route.thread.repoRoot);
          track("started");
        }

        return;
      }
      case "awaiting_pick":
        await this.reply(where, "Pick a project above first.");

        return;
      case "start":
        await this.start(where, message, text, route.repoRoot);
        track("started");

        return;
      case "ask":
        if (route.projects.length === 0) {
          await this.reply(
            where,
            "There are no projects in Argus yet. Add one on the Mac first.",
          );

          return;
        }
        this.deps.threads.put(message.channel, root, {
          kind: message.isDm ? "dm" : "channel",
          pending: { text, files: message.files, userId: message.user },
        });
        try {
          await this.deps.api.postMessage({
            ...where,
            ...projectPicker(route.projects),
          });
        } catch (e) {
          warn(`[slack] couldn't post the project picker: ${String(e)}`);
        }
        track("asked_project");
    }
  }

  private async tryClaim(
    message: SlackMessage,
    where: { channel: string; threadTs: string },
  ): Promise<boolean> {
    const attempt = claimAttempt(this.deps.config(), message.text);
    if (attempt === "none") {
      return false;
    }
    if (attempt === "wrong") {
      this.claimMisses++;
      if (this.claimMisses >= MAX_CLAIM_ATTEMPTS) {
        this.claimMisses = 0;
        this.deps.updateConfig((c) => ({ ...c, claimCode: newClaimCode() }));
      }
      await this.reply(where, "That code doesn't match the one Argus shows.");

      return true;
    }
    this.claimMisses = 0;
    const name = await this.deps.api.userName(message.user).catch(() => null);
    this.deps.updateConfig((c) => ({
      ...c,
      owner: { user_id: message.user, name },
      claimCode: null,
    }));
    await this.reply(
      where,
      "You're set. Mention me in a channel or message me here, and I'll start an agent on it.",
    );

    return true;
  }

  private async start(
    where: { channel: string; threadTs: string },
    message: { isDm: boolean; files: SlackFileRef[] },
    text: string,
    repoRoot: string,
  ): Promise<void> {
    const images = await this.images(message.files);
    const prompt = withFileNotes(text, message.files);
    const thread = this.deps.threads.put(where.channel, where.threadTs, {
      kind: message.isDm ? "dm" : "channel",
      repoRoot,
      sessionId: null,
      agentId: null,
      resumeRef: null,
      pending: null,
    });
    await this.bridge.beginTurn(thread);
    let started;
    try {
      started = await this.deps.startSession(repoRoot, prompt, images);
    } catch (e) {
      this.deps.threads.put(where.channel, where.threadTs, { repoRoot: null });
      await this.reply(
        where,
        `I couldn't start a session: ${typeof e === "string" ? e : String(e)}`,
      );

      return;
    }
    this.deps.threads.put(where.channel, where.threadTs, {
      sessionId: started.sessionId,
    });
    started.agentReady.then(async (agentId) => {
      if (!agentId) {
        await this.reply(
          where,
          "The session was created, but its agent didn't start. Open it in Argus to see why.",
        ).catch(() => undefined);
      }
    });
  }

  /** A fresh conversation with the teammate, bound to this Slack thread. */
  private async startTeammate(
    where: { channel: string; threadTs: string },
    message: SlackMessage,
    teammate: { id: string; name: string },
    text: string,
  ): Promise<void> {
    let started;
    try {
      started = await this.deps.startTeammate!(teammate.id);
    } catch (e) {
      await this.reply(
        where,
        `${teammate.name} couldn't start: ${typeof e === "string" ? e : String(e)}`,
      );

      return;
    }
    const thread = this.deps.threads.put(where.channel, where.threadTs, {
      kind: message.isDm ? "dm" : "channel",
      repoRoot: null,
      sessionId: started.sessionId,
      agentId: started.agentId,
      resumeRef: null,
      pending: null,
      teammate: {
        teammateId: teammate.id,
        threadId: started.threadId,
        name: teammate.name,
      },
    });
    await this.continueThread(thread, message, text);
  }

  private async continueThread(
    thread: SlackThread,
    message: SlackMessage,
    text: string,
  ): Promise<boolean> {
    const images = await this.images(message.files);
    const author = await this.deps.api.userName(message.user).catch(() => null);
    const sent = await this.deps.continueSession(
      thread,
      withFileNotes(text, message.files),
      images,
      author ? `${author} (Slack)` : "Slack",
    );
    if (!sent) {
      this.deps.threads.put(thread.channel, thread.threadTs, {
        sessionId: null,
        agentId: null,
      });

      return false;
    }
    const next = this.deps.threads.put(thread.channel, thread.threadTs, {
      agentId: sent.agentId,
    });
    await this.bridge.beginTurn(next);

    return true;
  }

  private async images(files: SlackFileRef[]): Promise<ImageAttachment[]> {
    const out: ImageAttachment[] = [];
    for (const file of files
      .filter((f) => IMAGE_TYPES.has(f.mimetype))
      .slice(0, MAX_IMAGES)) {
      try {
        const data = await this.deps.api.download(file.url, MAX_IMAGE_BYTES);
        out.push({ data: data.toString("base64"), media_type: file.mimetype });
      } catch (e) {
        warn(`[slack] couldn't download an attachment: ${String(e)}`);
      }
    }

    return out;
  }

  async handleAction(action: SlackAction): Promise<void> {
    const where = {
      channel: action.channel,
      threadTs: action.threadTs ?? action.messageTs,
    };
    if (!isAllowed(this.deps.config(), action.user)) {
      await this.reply(where, REFUSAL);

      return;
    }
    if (action.actionId.startsWith(ACTION_PICK_PROJECT)) {
      await this.pickProject(action, where);

      return;
    }
    if (action.actionId === ACTION_RESUME) {
      await this.resume(action, where);

      return;
    }
    if (action.actionId === ACTION_ALLOW || action.actionId === ACTION_DENY) {
      await this.answerPermission(
        action,
        where,
        action.actionId === ACTION_ALLOW ? "allow" : "deny",
      );
    }
  }

  private async pickProject(
    action: SlackAction,
    where: { channel: string; threadTs: string },
  ): Promise<void> {
    const thread = this.deps.threads.get(where.channel, where.threadTs);
    if (!thread?.pending) {
      return;
    }
    const repoRoot = this.deps
      .projects()
      .find((p) => projectToken(p) === action.value);
    if (!repoRoot) {
      await this.reply(
        where,
        "That project isn't in Argus any more. Pick another one.",
      );

      return;
    }
    const pending = thread.pending;
    try {
      await this.deps.api.updateMessage({
        channel: action.channel,
        ts: action.messageTs,
        ...pickedProject(repoRoot),
      });
    } catch (e) {
      warn(`[slack] couldn't update the project picker: ${String(e)}`);
    }
    await this.start(
      where,
      { isDm: thread.kind === "dm", files: pending.files },
      pending.text,
      repoRoot,
    );
  }

  /** Resume on a stopped teammate conversation's failure message. */
  private async resume(
    action: SlackAction,
    where: { channel: string; threadTs: string },
  ): Promise<void> {
    const thread = this.deps.threads.get(where.channel, where.threadTs);
    if (!thread?.teammate || !this.deps.resumeTeammate) {
      return;
    }
    const author = await this.deps.api.userName(action.user).catch(() => null);
    let resumed;
    try {
      resumed = await this.deps.resumeTeammate(
        thread.teammate.threadId,
        author ? `${author} (Slack)` : "Slack",
      );
    } catch (e) {
      await this.reply(
        where,
        `I couldn't resume it: ${typeof e === "string" ? e : String(e)}`,
      );

      return;
    }
    if (!resumed) {
      await this.reply(
        where,
        "That conversation is gone, so there's nothing to resume.",
      );

      return;
    }
    try {
      await this.deps.api.updateMessage({
        channel: action.channel,
        ts: action.messageTs,
        ...resumedMessage({
          line: parseResumeValue(action.value),
          by: action.user,
        }),
      });
    } catch (e) {
      warn(`[slack] couldn't update the failure message: ${String(e)}`);
    }
    const next = this.deps.threads.put(thread.channel, thread.threadTs, {
      agentId: resumed.agentId,
    });
    await this.bridge.beginTurn(next);
  }

  private async answerPermission(
    action: SlackAction,
    where: { channel: string; threadTs: string },
    decision: "allow" | "deny",
  ): Promise<void> {
    const ref = parsePermissionValue(action.value);
    if (!ref) {
      return;
    }
    // The button must belong to the agent this thread drives.
    const thread = this.deps.threads.byAgent(ref.agentId);
    if (
      !thread ||
      thread.channel !== where.channel ||
      thread.threadTs !== where.threadTs
    ) {
      return;
    }
    if (!this.deps.pendingPrompt(ref.agentId, ref.toolUseId)) {
      await this.reply(where, "That request was already answered.");

      return;
    }
    this.bridge.noteAnswer(ref.agentId, ref.toolUseId, action.user);
    try {
      this.deps.respondToPermission(ref.agentId, ref.toolUseId, decision);
      this.deps.telemetry.permissionAnswered(decision);
    } catch (e) {
      await this.reply(
        where,
        `I couldn't pass that on: ${typeof e === "string" ? e : String(e)}`,
      );
    }
  }

  dispose(): void {
    this.bridge.dispose();
  }
}

/** Files the agent can't see are named, so it knows they exist. */
function withFileNotes(text: string, files: SlackFileRef[]): string {
  const others = files.filter((f) => !IMAGE_TYPES.has(f.mimetype));
  if (others.length === 0) {
    return text;
  }
  const names = others.map((f) => f.name).join(", ");

  return `${text}\n\n(Also attached in Slack, not passed on: ${names})`.trim();
}
