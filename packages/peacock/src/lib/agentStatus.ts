import type { StatusTone } from "../components/Badge/Badge";

/** Canonical agent/activity status vocabulary used across the home screen. */
export type AgentStatus = "done" | "error" | "idle" | "pending" | "running";

export function agentStatusTone(status: AgentStatus): StatusTone {
  switch (status) {
    case "running":
      return "success";
    case "pending":
      return "warning";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export function agentStatusPulse(status: AgentStatus): boolean {
  return status === "running" || status === "pending";
}
