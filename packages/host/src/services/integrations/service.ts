/**
 * Connect, disconnect and call integrations. A call the service rejects for
 * auth flags the integration for reauth and tells every window, instead of
 * failing the same way on every later call.
 */

import type {
  IntegrationAccount,
  IntegrationId,
  IntegrationStatus,
  LinearIssue,
  LinearIssueContext,
  LinearIssueDetail,
  LinearTeam,
  LinkedIssue,
} from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { loadAppSettings } from "../appSettings/store";
import { capture } from "../telemetry/telemetry";
import {
  deleteIntegration,
  loadIntegration,
  markNeedsReauth,
  readSecret,
  saveIntegration,
} from "./credentials";
import { FigmaApi, FigmaAuthError } from "./figma/client";
import { LinearApi, LinearAuthError } from "./linear/client";
import {
  issueContext,
  issueDesignUrls,
  issueImageUrls,
} from "./linear/context";
import { parseLinearRef } from "./linear/refs";

export const INTEGRATION_STATUS_CHANGED = "integration_status_changed";

const IDS: IntegrationId[] = ["linear", "figma"];

export function integrationStatus(id: IntegrationId): IntegrationStatus {
  const entry = loadIntegration(id);

  return {
    id,
    connected: Boolean(entry),
    method: entry?.method ?? null,
    account: entry?.account ?? null,
    needsReauth: entry?.needsReauth ?? false,
  };
}

export function listIntegrations(): IntegrationStatus[] {
  return IDS.map(integrationStatus);
}

function announce(id: IntegrationId): void {
  emitHostEvent(INTEGRATION_STATUS_CHANGED, integrationStatus(id));
}

const SERVICE_NAMES: Record<IntegrationId, string> = {
  figma: "Figma",
  linear: "Linear",
};

/** Who the key signs in as; throws a sentence when the service rejects it. */
async function accountForKey(
  id: IntegrationId,
  secret: string,
): Promise<IntegrationAccount> {
  try {
    return id === "linear"
      ? await new LinearApi({ method: "key", secret }).account()
      : await new FigmaApi(secret).account();
  } catch (err) {
    if (err instanceof LinearAuthError || err instanceof FigmaAuthError) {
      throw `${SERVICE_NAMES[id]} didn't accept that key.`;
    }
    throw err instanceof Error ? err.message : String(err);
  }
}

export async function connectWithKey(
  id: IntegrationId,
  key: string,
): Promise<IntegrationStatus> {
  const secret = key.trim();
  if (!secret) {
    throw "Paste a key first.";
  }
  let account;
  try {
    account = await accountForKey(id, secret);
  } catch (err) {
    capture("integration_connected", {
      method: "key",
      service: id,
      success: false,
    });
    throw err;
  }
  saveIntegration(id, { method: "key", secret, account });
  capture("integration_connected", {
    method: "key",
    service: id,
    success: true,
  });
  announce(id);

  return integrationStatus(id);
}

/** The service rejected a saved credential: flag it once and tell every window. */
export function credentialRejected(id: IntegrationId): string {
  markNeedsReauth(id);
  capture("integration_reauth_needed", { service: id });
  announce(id);

  return `${SERVICE_NAMES[id]} rejected the saved credential. Reconnect it in Settings → Integrations.`;
}

export function disconnect(id: IntegrationId): void {
  deleteIntegration(id);
  announce(id);
}

/** Null when Linear isn't connected or its credential is known to be dead. */
export function linearApi(): LinearApi | null {
  const entry = loadIntegration("linear");
  if (!entry || entry.needsReauth) {
    return null;
  }
  const secret = readSecret("linear");

  return secret ? new LinearApi({ method: entry.method, secret }) : null;
}

async function withLinear<T>(fn: (api: LinearApi) => Promise<T>): Promise<T> {
  const api = linearApi();
  if (!api) {
    throw "Linear isn't connected. Connect it in Settings → Integrations.";
  }
  try {
    return await fn(api);
  } catch (err) {
    if (err instanceof LinearAuthError) {
      throw credentialRejected("linear");
    }
    throw err instanceof Error ? err.message : err;
  }
}

export function listLinearIssues(
  query: string | null,
  limit: number,
): Promise<LinearIssue[]> {
  const term = query?.trim();

  return withLinear(async (api) => {
    if (!term) {
      return api.myIssues(limit);
    }
    // An identifier or URL is a lookup, not a search: Linear's search ranks it poorly.
    const identifier = parseLinearRef(term);
    if (identifier) {
      const issue = await api.issue(identifier);

      return issue ? [issue] : [];
    }

    return api.searchIssues(term, limit);
  });
}

export function getLinearIssue(ref: string): Promise<LinearIssueDetail | null> {
  const identifier = parseLinearRef(ref);
  if (!identifier) {
    return Promise.resolve(null);
  }

  return withLinear((api) => api.issue(identifier));
}

/** A session was just created from an issue. Never blocks or fails the session. */
export function issueSessionStarted(issue: LinkedIssue): void {
  capture("session_started_from_issue", { source: issue.source });
  if (loadAppSettings().linear_mark_started === false) {
    return;
  }
  withLinear((api) => api.markStarted(issue.identifier)).catch(
    (err: unknown) => {
      warn(
        `[integrations] couldn't move ${issue.identifier} to started: ${String(err)}`,
      );
    },
  );
}

const MAX_CONTEXT_IMAGES = 5;

export function linearIssueContext(
  ref: string,
): Promise<LinearIssueContext | null> {
  const identifier = parseLinearRef(ref);
  if (!identifier) {
    return Promise.resolve(null);
  }

  return withLinear(async (api) => {
    const issue = await api.issue(identifier);
    if (!issue) {
      return null;
    }
    const urls = issueImageUrls(issue).slice(0, MAX_CONTEXT_IMAGES);
    // A screenshot that won't download shouldn't stop the agent starting.
    const images = await Promise.all(
      urls.map((u) => api.image(u).catch(() => null)),
    );

    return {
      issue,
      context: issueContext(issue),
      images: images.filter((i) => i !== null),
      designUrls: issueDesignUrls(issue),
    };
  });
}

/** Posts as the connected Linear user. Returns the issue it landed on. */
export function commentOnLinearIssue(
  ref: string,
  body: string,
): Promise<LinearIssue> {
  const identifier = parseLinearRef(ref);
  if (!identifier) {
    return Promise.reject(`"${ref}" isn't a Linear issue identifier or link.`);
  }

  return withLinear(async (api) => {
    const issue = await api.issue(identifier);
    if (!issue) {
      throw `Linear has no issue ${identifier}.`;
    }
    await api.comment(issue.id, body);

    return issue;
  });
}

export function listLinearTeams(): Promise<LinearTeam[]> {
  return withLinear((api) => api.teams());
}

export function fileLinearIssue(input: {
  teamId: string;
  title: string;
  description: string;
  screenshot: string | null;
}): Promise<LinearIssue> {
  return withLinear(async (api) => {
    const shot = input.screenshot
      ? await api.upload(
          Buffer.from(input.screenshot, "base64"),
          "screenshot.png",
        )
      : null;
    const description = [
      input.description.trim(),
      shot && `![Screenshot](${shot})`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const issue = await api.createIssue({
      teamId: input.teamId,
      title: input.title.trim(),
      description,
    });
    capture("issue_filed_from_device", { has_screenshot: Boolean(shot) });

    return issue;
  });
}
