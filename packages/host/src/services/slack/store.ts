/**
 * `$ARGUS_HOME/slack.json`: the two tokens sealed with the host's secret
 * storage, plus the routing and access config. Never in `app-settings.json`,
 * which paired devices can read and write.
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

interface SlackFile {
  /** Base64 of the sealed tokens. */
  sealedBot?: string;
  sealedApp?: string;
  identity?: SlackIdentity;
  config?: Partial<SlackConfig>;
}

export interface SlackTokens {
  bot: string;
  app: string;
}

function filePath(): string {
  return path.join(argusHomeDir(), "slack.json");
}

function readFile(): SlackFile {
  try {
    return JSON.parse(fs.readFileSync(filePath(), "utf8")) as SlackFile;
  } catch {
    return {};
  }
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

export function newClaimCode(): string {
  return String(crypto.randomInt(100_000, 1_000_000));
}

export function loadSlackConfig(): SlackConfig {
  const config = readFile().config ?? {};

  return {
    defaultProject: config.defaultProject ?? null,
    mappings: config.mappings ?? [],
    allowedUsers: config.allowedUsers ?? [],
    owner: config.owner ?? null,
    claimCode: config.claimCode ?? null,
  };
}

export function updateSlackConfig(
  fn: (config: SlackConfig) => SlackConfig,
): SlackConfig {
  const file = readFile();
  const next = fn(loadSlackConfig());
  writeFile({ ...file, config: next });

  return next;
}

export function loadSlackIdentity(): SlackIdentity | null {
  return readFile().identity ?? null;
}

export function hasSlackTokens(): boolean {
  const file = readFile();

  return Boolean(file.sealedBot && file.sealedApp);
}

/** The unsealed tokens, or null when there are none or they can't be unsealed. */
export function readSlackTokens(): SlackTokens | null {
  const file = readFile();
  if (!file.sealedBot || !file.sealedApp) {
    return null;
  }
  const storage = hostPlatform().secretStorage;
  try {
    return {
      bot: storage.decrypt(Buffer.from(file.sealedBot, "base64")),
      app: storage.decrypt(Buffer.from(file.sealedApp, "base64")),
    };
  } catch {
    warn("[slack] the saved tokens can't be unsealed");

    return null;
  }
}

/** Throws a sentence when the machine has nowhere safe to keep them. */
export function saveSlackTokens(
  tokens: SlackTokens,
  identity: SlackIdentity,
): void {
  const storage = hostPlatform().secretStorage;
  if (!storage.isAvailable()) {
    throw "This machine has no secure storage to keep the Slack tokens in.";
  }
  const file = readFile();
  // A different workspace's owner and channels mean nothing here.
  const sameTeam = file.identity?.teamId === identity.teamId;
  const config = sameTeam ? loadSlackConfig() : null;
  writeFile({
    sealedBot: storage.encrypt(tokens.bot).toString("base64"),
    sealedApp: storage.encrypt(tokens.app).toString("base64"),
    identity,
    config: {
      defaultProject: config?.defaultProject ?? null,
      mappings: config?.mappings ?? [],
      allowedUsers: config?.allowedUsers ?? [],
      owner: config?.owner ?? null,
      claimCode: config?.owner ? null : newClaimCode(),
    },
  });
}

/** Drops the tokens; routing and access stay for a reconnect. */
export function deleteSlackTokens(): void {
  const file = readFile();
  writeFile({ identity: file.identity, config: file.config });
}
