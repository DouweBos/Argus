/**
 * One Slack thread is one Argus session and its agent. Kept in
 * `$ARGUS_HOME/slack-threads.json` so a reply after a host restart still
 * reaches the same session, and resumes its conversation.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

export interface SlackFileRef {
  url: string;
  mimetype: string;
  name: string;
}

/** What a thread asked before it had a project. */
export interface PendingAsk {
  text: string;
  files: SlackFileRef[];
  userId: string;
}

export interface SlackThread {
  channel: string;
  threadTs: string;
  kind: "channel" | "dm";
  repoRoot: string | null;
  sessionId: string | null;
  agentId: string | null;
  /** The runner's conversation id, to resume once the agent is gone. */
  resumeRef: string | null;
  /** The "working on it" message that gets edited with progress. */
  statusTs: string | null;
  /** Set while the thread waits for a project pick. */
  pending: PendingAsk | null;
  /** A teammate's conversation instead of a project session. Missing on older records. */
  teammate?: { teammateId: string; threadId: string; name?: string } | null;
  updatedAt: number;
}

const MAX_THREADS = 500;

export function threadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

export class SlackThreadStore {
  private threads = new Map<string, SlackThread>();
  private loaded = false;

  constructor(private readonly file: () => string = defaultFile) {}

  get(channel: string, threadTs: string): SlackThread | null {
    this.load();

    return this.threads.get(threadKey(channel, threadTs)) ?? null;
  }

  byAgent(agentId: string): SlackThread | null {
    this.load();
    for (const thread of this.threads.values()) {
      if (thread.agentId === agentId) {
        return thread;
      }
    }

    return null;
  }

  bySession(sessionId: string): SlackThread | null {
    this.load();
    for (const thread of this.threads.values()) {
      if (thread.sessionId === sessionId) {
        return thread;
      }
    }

    return null;
  }

  all(): SlackThread[] {
    this.load();

    return [...this.threads.values()];
  }

  /** Create or merge; returns the stored thread. */
  put(
    channel: string,
    threadTs: string,
    patch: Partial<Omit<SlackThread, "channel" | "threadTs">>,
  ): SlackThread {
    this.load();
    const key = threadKey(channel, threadTs);
    const current = this.threads.get(key);
    const next: SlackThread = {
      channel,
      threadTs,
      kind: "channel",
      repoRoot: null,
      sessionId: null,
      agentId: null,
      resumeRef: null,
      statusTs: null,
      pending: null,
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    this.threads.delete(key);
    this.threads.set(key, next);
    this.prune();
    this.save();

    return next;
  }

  /** Forget threads whose session is gone. */
  dropSession(sessionId: string): void {
    this.load();
    let changed = false;
    for (const [key, thread] of this.threads) {
      if (thread.sessionId === sessionId) {
        this.threads.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  clear(): void {
    this.threads.clear();
    this.loaded = true;
    this.save();
  }

  private prune(): void {
    while (this.threads.size > MAX_THREADS) {
      let oldest: string | null = null;
      let at = Infinity;
      for (const [key, thread] of this.threads) {
        if (thread.updatedAt < at) {
          at = thread.updatedAt;
          oldest = key;
        }
      }
      if (oldest === null) {
        return;
      }
      this.threads.delete(oldest);
    }
  }

  private load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(), "utf8")) as {
        threads?: SlackThread[];
      };
      for (const thread of parsed.threads ?? []) {
        this.threads.set(threadKey(thread.channel, thread.threadTs), thread);
      }
    } catch {
      // No file yet.
    }
  }

  private save(): void {
    const target = this.file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ threads: [...this.threads.values()] }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    fs.renameSync(tmp, target);
  }
}

function defaultFile(): string {
  return path.join(argusHomeDir(), "slack-threads.json");
}
