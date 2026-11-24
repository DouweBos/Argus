/**
 * The few Slack Web API calls Argus makes. Tokens only ever go in the
 * `Authorization` header; errors carry Slack's error code, never the token.
 */

import type { SlackChannel } from "@argus/remote-protocol";

export type FetchLike = typeof fetch;

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
  }

  /** The token was revoked or is for the wrong kind of call. */
  get isAuth(): boolean {
    return [
      "invalid_auth",
      "not_authed",
      "account_inactive",
      "token_revoked",
      "token_expired",
      "not_allowed_token_type",
    ].includes(this.code);
  }
}

export interface PostedMessage {
  channel: string;
  ts: string;
}

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

const API = "https://slack.com/api";

export class SlackApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async call<T extends Record<string, unknown>>(
    method: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.fetchImpl(`${API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new SlackApiError(method, `http_${res.status}`);
    }
    const json = (await res.json()) as T & { ok?: boolean; error?: string };
    if (!json.ok) {
      throw new SlackApiError(method, json.error ?? "unknown_error");
    }

    return json;
  }

  async authTest(): Promise<{
    teamId: string;
    team: string;
    userId: string;
    user: string;
  }> {
    const r = await this.call<{
      team_id: string;
      team: string;
      user_id: string;
      user: string;
    }>("auth.test");

    return { teamId: r.team_id, team: r.team, userId: r.user_id, user: r.user };
  }

  async postMessage(message: {
    channel: string;
    threadTs?: string;
    text: string;
    blocks?: SlackBlock[];
  }): Promise<PostedMessage> {
    const r = await this.call<{ channel: string; ts: string }>(
      "chat.postMessage",
      {
        channel: message.channel,
        thread_ts: message.threadTs,
        text: message.text,
        blocks: message.blocks,
        unfurl_links: false,
        unfurl_media: false,
      },
    );

    return { channel: r.channel, ts: r.ts };
  }

  async updateMessage(message: {
    channel: string;
    ts: string;
    text: string;
    blocks?: SlackBlock[];
  }): Promise<void> {
    await this.call("chat.update", {
      channel: message.channel,
      ts: message.ts,
      text: message.text,
      blocks: message.blocks ?? [],
    });
  }

  async userName(userId: string): Promise<string | null> {
    try {
      const r = await this.call<{
        user?: {
          name?: string;
          real_name?: string;
          profile?: { display_name?: string };
        };
      }>("users.info", { user: userId });
      const u = r.user;

      return u?.profile?.display_name || u?.real_name || u?.name || null;
    } catch (e) {
      if (e instanceof SlackApiError && e.code === "user_not_found") {
        throw "Slack has no member with that ID.";
      }

      return null;
    }
  }

  async listChannels(): Promise<SlackChannel[]> {
    const out: SlackChannel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await this.call<{
        channels: {
          id: string;
          name: string;
          is_private?: boolean;
          is_member?: boolean;
        }[];
        response_metadata?: { next_cursor?: string };
      }>("conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      });
      for (const c of r.channels) {
        out.push({
          id: c.id,
          name: c.name,
          is_private: c.is_private ?? false,
          is_member: c.is_member ?? false,
        });
      }
      cursor = r.response_metadata?.next_cursor || undefined;
      if (!cursor) {
        break;
      }
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A file a message carried; needs the `files:read` scope. */
  async download(url: string, maxBytes: number): Promise<Buffer> {
    if (!/^https:\/\/([a-z0-9-]+\.)*slack(-edge)?\.com\//.test(url)) {
      throw new SlackApiError("files.download", "not_a_slack_url");
    }
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new SlackApiError("files.download", `http_${res.status}`);
    }
    const size = Number(res.headers.get("content-length") ?? "0");
    if (size > maxBytes) {
      throw new SlackApiError("files.download", "too_large");
    }
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) {
      throw new SlackApiError("files.download", "too_large");
    }

    return data;
  }

  /** The Socket Mode websocket URL; called with the app-level token. */
  async openConnection(): Promise<string> {
    const r = await this.call<{ url: string }>("apps.connections.open");

    return r.url;
  }
}
