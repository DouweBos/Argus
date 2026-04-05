import { ChangesView } from "../../agent/ChangesView";

interface ChangesToolProps {
  baseBranch?: null | string;
  branchName?: string;
  repoRoot: string;
  workspaceId: null | string;
}

export function ChangesTool({
  workspaceId,
  baseBranch,
  branchName,
  repoRoot,
}: ChangesToolProps) {
  if (!workspaceId) {
    return null;
  }

  return (
    <ChangesView
      workspaceId={workspaceId}
      baseBranch={baseBranch}
      branchName={branchName}
      repoRoot={repoRoot}
    />
  );
}
