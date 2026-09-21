/**
 * Which inbox surface the URL is asking for: the briefing, or one proposal.
 */

import { useRouteProposalId } from "../../lib/routeHooks";
import { InboxScreen } from "./InboxScreen/InboxScreen";
import { ProposalDetailScreen } from "./ProposalDetailScreen/ProposalDetailScreen";

export function InboxRoot() {
  return useRouteProposalId() ? <ProposalDetailScreen /> : <InboxScreen />;
}
