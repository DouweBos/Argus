/**
 * Which integrations the computer has connected, and as whom. The TS twin of
 * ArgusUI's `IntegrationLabels`.
 */

import type { IntegrationStatus } from "@argus/remote-protocol";

export type IntegrationTone = "neutral" | "success" | "warning";

export interface IntegrationView {
  id: string;
  name: string;
  /** "Connected", "Reconnect" or "Not connected". */
  stateLabel: string;
  tone: IntegrationTone;
  /** "Ada Lovelace · Acme", or null when nothing is connected. */
  account: string | null;
}

export function integrationName(id: string): string {
  switch (id) {
    case "linear":
      return "Linear";
    case "figma":
      return "Figma";
    default:
      return id.charAt(0).toUpperCase() + id.slice(1);
  }
}

export function integrationView(status: IntegrationStatus): IntegrationView {
  const base = { id: status.id, name: integrationName(status.id) };
  if (!status.connected) {
    return {
      ...base,
      stateLabel: "Not connected",
      tone: "neutral",
      account: null,
    };
  }
  const account = status.account
    ? [status.account.name, status.account.workspace]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : null;

  return status.needsReauth
    ? { ...base, stateLabel: "Reconnect", tone: "warning", account }
    : { ...base, stateLabel: "Connected", tone: "success", account };
}
