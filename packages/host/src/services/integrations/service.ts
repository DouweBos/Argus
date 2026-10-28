/**
 * Connect, disconnect and call integrations. A call the service rejects for
 * auth flags the integration for reauth and tells every window, instead of
 * failing the same way on every later call.
 */

import type {
  IntegrationId,
  IntegrationStatus,
  LinearIssue,
  LinearIssueDetail,
} from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { capture } from "../telemetry/telemetry";
import {
  deleteIntegration,
  loadIntegration,
  markNeedsReauth,
  readSecret,
  saveIntegration,
} from "./credentials";
import { LinearApi, LinearAuthError } from "./linear/client";
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

export async function connectWithKey(
  id: IntegrationId,
  key: string,
): Promise<IntegrationStatus> {
  const secret = key.trim();
  if (!secret) {
    throw "Paste an API key first.";
  }
  if (id !== "linear") {
    throw `Connecting ${id} isn't supported yet.`;
  }
  let account;
  try {
    account = await new LinearApi({ method: "key", secret }).account();
  } catch (err) {
    capture("integration_connected", {
      method: "key",
      service: id,
      success: false,
    });
    throw err instanceof LinearAuthError
      ? "Linear didn't accept that API key."
      : String(err instanceof Error ? err.message : err);
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
      markNeedsReauth("linear");
      capture("integration_reauth_needed", { service: "linear" });
      announce("linear");
      throw "Linear rejected the saved credential. Reconnect it in Settings → Integrations.";
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
