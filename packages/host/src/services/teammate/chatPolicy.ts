import type { Teammate } from "./models";
import type { Automation } from "../automation/models";
import { findTeammate } from "./registry";

/** The id a conversation's synthetic automation goes by, in gate logs and claims. */
export function chatAutomationId(teammateId: string): string {
  return `teammate-chat:${teammateId}`;
}

/**
 * What a conversation is held to, in the shape every guard already reads:
 * the teammate's own autonomy, guardrails and scope. Never persisted.
 */
export function teammateChatAutomation(teammate: Teammate): Automation {
  return {
    id: chatAutomationId(teammate.id),
    name: teammate.name,
    description: teammate.tagline,
    enabled: true,
    trigger: { kind: "manual" },
    scope: { repo_roots: [...teammate.scope.repo_roots] },
    source_ids: [...teammate.source_ids],
    playbook: "",
    extra_instructions: "",
    autonomy: teammate.autonomy,
    guardrails: { ...teammate.guardrails },
    model: teammate.model,
    runner: teammate.runner,
    claude_account_id: teammate.claude_account_id,
    template_id: null,
    teammate_id: teammate.id,
    report_slack_channel: null,
    seeded_playbook_hash: null,
    created_at: teammate.created_at,
    updated_at: teammate.updated_at,
    last_run_at: null,
    next_run_at: null,
  };
}

export function chatAutomationFor(teammateId: string): Automation | null {
  const teammate = findTeammate(teammateId);

  return teammate ? teammateChatAutomation(teammate) : null;
}
