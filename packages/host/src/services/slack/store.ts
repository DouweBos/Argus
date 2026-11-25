/**
 * `$ARGUS_HOME/slack.json`: every connected workspace's two tokens sealed
 * with the host's secret storage, plus its routing and access config. Never
 * in `app-settings.json`, which paired devices can read and write.
 */

import type { SlackChannelMapping, SlackUser } from "@argus/remote-protocol";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { hostPlatform } from "../../platform";

export interface SlackIdentity {
  teamId: string;
  workspace: string;
  botUserId: string;
  botName: string;
}

export interface SlackConfig {
  defaultProject: string | null;
  mappings: SlackChannelMapping[];
  allowedUsers: SlackUser[];
  owner: SlackUser | null;
  /** Until someone claims the bot; null once claimed. */
  claimCode: string | null;
}

/** An app Argus created from a configuration token. */
export interface SlackApp {
  id: string;
  name: string;
}

interface WorkspaceRecord {
  /** Base64 of the sealed tokens; gone once disconnected. */
  sealedBot?: string;
  sealedApp?: string;
  identity: SlackIdentity;
  config?: Partial<SlackConfig>;
  app?: SlackApp;
}

interface SlackFile {
  workspaces?: WorkspaceRecord[];
  /** Created, not yet connected: its workspace is only known once it is. */
  pendingApp?: SlackApp;
}

/** The single-workspace file older hosts wrote. */
interface LegacyFile {
  sealedBot?: string;
  sealedApp?: string;
  identity?: SlackIdentity;
  config?: Partial<SlackConfig>;
  app?: SlackApp;
}

export interface SlackTokens {
  bot: string;
  app: string;
}

function filePath(): string {
  return path.join(argusHomeDir(), "slack.json");
}

/** One workspace's threads; the single-workspace host kept them in one file. */
export function slackThreadsFile(teamId: string): string {
  return path.join(argusHomeDir(), `slack-threads-${teamId}.json`);
}

function migrate(legacy: LegacyFile): SlackFile {
  if (!legacy.identity) {
    return legacy.app ? { pendingApp: legacy.app } : {};
  }
  const { teamId } = legacy.identity;
  const connected = Boolean(legacy.sealedBot && legacy.sealedApp);
  const oldThreads = path.join(argusHomeDir(), "slack-threads.json");
  try {
    if (fs.existsSync(oldThreads)) {
      fs.renameSync(oldThreads, slackThreadsFile(teamId));
    }
  } catch (e) {
    warn(`[slack] couldn't move the Slack threads file: ${String(e)}`);
  }
  const next: SlackFile = {
    workspaces: [
      {
        sealedBot: legacy.sealedBot,
        sealedApp: legacy.sealedApp,
        identity: legacy.identity,
        config: legacy.config,
        app: connected ? legacy.app : undefined,
      },
    ],
    pendingApp: connected ? undefined : legacy.app,
  };
  writeFile(next);

  return next;
}

function readFile(): SlackFile {
  let parsed: LegacyFile & SlackFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as LegacyFile &
      SlackFile;
  } catch {
    return {};
  }

  const legacy = ["identity", "sealedBot", "config", "app"].some(
    (key) => key in parsed,
  );

  return legacy ? migrate(parsed) : parsed;
}

function writeFile(next: SlackFile): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, target);
}

function updateWorkspace(
  teamId: string,
  fn: (record: WorkspaceRecord) => WorkspaceRecord | null,
): void {
  const file = readFile();
  const workspaces = (file.workspaces ?? []).flatMap((w) => {
    if (w.identity.teamId !== teamId) {
      return [w];
    }
    const next = fn(w);

    return next ? [next] : [];
  });
  writeFile({ ...file, workspaces });
}

function record(teamId: string): WorkspaceRecord | null {
  return (
    readFile().workspaces?.find((w) => w.identity.teamId === teamId) ?? null
  );
}

export function newClaimCode(): string {
  return String(crypto.randomInt(100_000, 1_000_000));
}

function normalize(config: Partial<SlackConfig> | undefined): SlackConfig {
  return {
    defaultProject: config?.defaultProject ?? null,
    mappings: config?.mappings ?? [],
    allowedUsers: config?.allowedUsers ?? [],
    owner: config?.owner ?? null,
    claimCode: config?.claimCode ?? null,
  };
}

/** Every workspace Argus knows, connected or not, in the order they were added. */
export function listSlackWorkspaces(): {
  identity: SlackIdentity;
  config: SlackConfig;
  connected: boolean;
  app: SlackApp | null;
}[] {
  return (readFile().workspaces ?? []).map((w) => ({
    identity: w.identity,
    config: normalize(w.config),
    connected: Boolean(w.sealedBot && w.sealedApp),
    app: w.app ?? null,
  }));
}

export function loadSlackConfig(teamId: string): SlackConfig {
  return normalize(record(teamId)?.config);
}

export function updateSlackConfig(
  teamId: string,
  fn: (config: SlackConfig) => SlackConfig,
): SlackConfig {
  const next = fn(loadSlackConfig(teamId));
  updateWorkspace(teamId, (w) => ({ ...w, config: next }));

  return next;
}

export function loadSlackIdentity(teamId: string): SlackIdentity | null {
  return record(teamId)?.identity ?? null;
}

export function hasSlackTokens(teamId: string): boolean {
  const w = record(teamId);

  return Boolean(w?.sealedBot && w.sealedApp);
}

/** The unsealed tokens, or null when there are none or they can't be unsealed. */
export function readSlackTokens(teamId: string): SlackTokens | null {
  const w = record(teamId);
  if (!w?.sealedBot || !w.sealedApp) {
    return null;
  }
  const storage = hostPlatform().secretStorage;
  try {
    return {
      bot: storage.decrypt(Buffer.from(w.sealedBot, "base64")),
      app: storage.decrypt(Buffer.from(w.sealedApp, "base64")),
    };
  } catch {
    warn("[slack] a workspace's saved tokens can't be unsealed");

    return null;
  }
}

/**
 * Adds the workspace, or replaces its tokens when it's already known; its
 * owner and channels stay. The app created last belongs to it now.
 * Throws a sentence when the machine has nowhere safe to keep them.
 */
export function saveSlackTokens(
  tokens: SlackTokens,
  identity: SlackIdentity,
): void {
  const storage = hostPlatform().secretStorage;
  if (!storage.isAvailable()) {
    throw "This machine has no secure storage to keep the Slack tokens in.";
  }
  const file = readFile();
  const existing = record(identity.teamId);
  const config = normalize(existing?.config);
  const next: WorkspaceRecord = {
    sealedBot: storage.encrypt(tokens.bot).toString("base64"),
    sealedApp: storage.encrypt(tokens.app).toString("base64"),
    identity,
    config: {
      ...config,
      claimCode: config.owner ? null : newClaimCode(),
    },
    app: file.pendingApp ?? existing?.app,
  };
  const others = (file.workspaces ?? []).filter(
    (w) => w.identity.teamId !== identity.teamId,
  );
  writeFile({
    workspaces: existing
      ? (file.workspaces ?? []).map((w) =>
          w.identity.teamId === identity.teamId ? next : w,
        )
      : [...others, next],
  });
}

/** Drops the tokens; routing and access stay for a reconnect. */
export function deleteSlackTokens(teamId: string): void {
  updateWorkspace(teamId, ({ identity, config, app }) => ({
    identity,
    config,
    app,
  }));
}

/** Forgets the workspace entirely: tokens, owner, members and channels. */
export function removeSlackWorkspace(teamId: string): void {
  updateWorkspace(teamId, () => null);
  try {
    fs.rmSync(slackThreadsFile(teamId), { force: true });
  } catch {
    // Nothing to forget.
  }
}

export function loadPendingSlackApp(): SlackApp | null {
  return readFile().pendingApp ?? null;
}

/** Null forgets it, to start over with another app. */
export function savePendingSlackApp(app: SlackApp | null): void {
  writeFile({ ...readFile(), pendingApp: app ?? undefined });
}
