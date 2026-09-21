/**
 * Resolving a proposal's primary action.
 *
 * The run writes the CTA, because only it knows whether the next move is a
 * worktree, a PR to open or nothing at all. Runs that predate the field — and
 * runs that just don't say — fall back to what the proposal already implies.
 */

import type { Proposal, ProposalCta, ProposalCtaInput } from "./models";

/** A `start_session` CTA needs somewhere to work; `open_url` needs a link. */
export function resolveCta(
  input: ProposalCtaInput | null | undefined,
  context: Pick<Proposal, "recommended_action" | "repo_root" | "source_ref">,
): ProposalCta | null {
  const label = input?.label.trim();
  if (input && label) {
    if (input.kind === "start_session") {
      return context.repo_root ? { kind: input.kind, label, url: null } : null;
    }
    const url = input.url?.trim() || context.source_ref?.url;

    return url ? { kind: input.kind, label, url } : null;
  }

  return derivedCta(context);
}

/** What the proposal asks for when it never said. */
function derivedCta(
  context: Pick<Proposal, "recommended_action" | "repo_root" | "source_ref">,
): ProposalCta | null {
  if (context.recommended_action === "start_session" && context.repo_root) {
    return { kind: "start_session", label: "Start", url: null };
  }
  const source = context.source_ref;
  if (source) {
    return {
      kind: "open_url",
      label: `Open ${source.external_id}`,
      url: source.url,
    };
  }

  return null;
}
