/**
 * The shipping screens, loaded on first use: branches, a branch, a comparison,
 * stashes, a commit, and pull requests.
 */

import type { ShipScreen } from "../../routing/shipScreens";
import { BranchesScreen } from "./BranchesScreen";
import { BranchScreen } from "./BranchScreen";
import { CommitScreen } from "./CommitScreen";
import { CompareScreen } from "./CompareScreen";
import { PullRequestScreen } from "./PullRequestScreen";
import { PullRequestsScreen } from "./PullRequestsScreen";
import { StashesScreen } from "./StashesScreen";
import "./ship.css";

export default function ShipScreenBody({ screen }: { screen: ShipScreen }) {
  switch (screen.name) {
    case "branches":
      return <BranchesScreen sessionId={screen.sessionId} />;
    case "branch":
      return (
        <BranchScreen
          key={`${screen.sessionId}:${screen.ref}`}
          sessionId={screen.sessionId}
          refName={screen.ref}
        />
      );
    case "compare":
      return (
        <CompareScreen
          sessionId={screen.sessionId}
          left={screen.left}
          right={screen.right}
        />
      );
    case "stashes":
      return <StashesScreen sessionId={screen.sessionId} />;
    case "commit":
      return <CommitScreen sessionId={screen.sessionId} hash={screen.hash} />;
    case "pullRequests":
      return <PullRequestsScreen />;
    case "pullRequest":
      return (
        <PullRequestScreen
          key={`${screen.owner}/${screen.repo}#${screen.number}`}
          owner={screen.owner}
          repo={screen.repo}
          number={screen.number}
        />
      );
  }
}
