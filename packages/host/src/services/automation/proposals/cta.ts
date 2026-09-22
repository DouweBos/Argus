/**
 * Resolving a proposal's primary action.
 *
 * The run writes the CTA, because only it knows whether the next move is a
 * worktree, a PR to open or a branch to clear. Runs that predate the field —
 * and runs that just don't say — fall back to what the proposal already
 * implies. A CTA missing what it would act on resolves to none at all: the
 * inbox showing no button is better than a button that cannot work.
 */

import type { Proposal, ProposalCta, ProposalCtaInput } from "./models";

type CtaContext = Pick<
  Proposal,
  "recommended_action" | "repo_root" | "source_ref"
>;

/** Every field the kind in hand does not use, spelled out rather than absent. */
function cta(
  patch: Partial<ProposalCta> & Pick<ProposalCta, "kind" | "label">,
): ProposalCta {
  return {
    url: null,
    branch: null,
    force: false,
    session_id: null,
    ...patch,
  };
}

export function resolveCta(
  input: ProposalCtaInput | null | undefined,
  context: CtaContext,
): ProposalCta | null {
  const label = input?.label.trim();
  if (!input || !label) {
    return derivedCta(context);
  }

  switch (input.kind) {
    case "start_session":
      return context.repo_root ? cta({ kind: input.kind, label }) : null;
    case "delete_branch": {
      const branch = input.branch?.trim();

      return branch && context.repo_root
        ? cta({
            kind: input.kind,
            label,
            branch,
            force: input.force === true,
          })
        : null;
    }
    case "delete_session": {
      const sessionId = input.session_id?.trim();

      return sessionId
        ? cta({ kind: input.kind, label, session_id: sessionId })
        : null;
    }
    case "open_url": {
      const url = input.url?.trim() || context.source_ref?.url;

      return url ? cta({ kind: input.kind, label, url }) : null;
    }
  }
}

/** What the proposal asks for when it never said. */
function derivedCta(context: CtaContext): ProposalCta | null {
  if (context.recommended_action === "start_session" && context.repo_root) {
    return cta({ kind: "start_session", label: "Start" });
  }
  const source = context.source_ref;
  if (source) {
    return cta({
      kind: "open_url",
      label: `Open ${source.external_id}`,
      url: source.url,
    });
  }

  return null;
}
