/**
 * The land-work card's two questions: how a merge into the base keeps the
 * session's commits, and which local branch is the base.
 */

import { useEffect } from "react";
import {
  baseBranchLabel,
  LAND_MERGE_STRATEGIES,
  type LandMergeStrategy,
} from "@argus/client-core";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Icons,
  SidebarItem,
  Spinner,
} from "@argus/peacock";
import { useBranchesStore } from "../../stores/branches";

/** Two buttons, no default: a squash rewrites the commits the agent wrote. */
export function MergeIntoBaseDialog({
  base,
  onCancel,
  onPick,
}: {
  base: string | null | undefined;
  onCancel: () => void;
  onPick: (strategy: LandMergeStrategy) => void;
}) {
  return (
    <Dialog
      title={`Merge into ${baseBranchLabel(base)}?`}
      titleId="aw-land-merge"
      onClose={onCancel}
    >
      <DialogBody>
        Uncommitted changes are committed first. A conflict stops the merge.
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {LAND_MERGE_STRATEGIES.map((s) => (
          <Button
            key={s.value}
            variant="secondary"
            leading={<Icons.MergeIcon size={12} />}
            onClick={() => onPick(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </DialogFooter>
    </Dialog>
  );
}

const EMPTY: never[] = [];

/**
 * Only local branches: the computer can't fast-forward a remote-tracking ref
 * like `origin/main`, which is what used to make a merge fail halfway.
 */
export function BaseBranchDialog({
  current,
  onCancel,
  onPick,
  sessionId,
}: {
  current: string | null | undefined;
  onCancel: () => void;
  onPick: (branch: string) => void;
  sessionId: string;
}) {
  const branches = useBranchesStore((s) => s.bySession[sessionId] ?? EMPTY);
  const loaded = useBranchesStore(
    (s) => s.loadBySession[sessionId]?.loaded ?? false,
  );
  const local = branches.filter((b) => b.scope === "local");

  useEffect(() => {
    void useBranchesStore.getState().refresh(sessionId);
  }, [sessionId]);

  return (
    <Dialog title="Base branch" titleId="aw-land-base" onClose={onCancel}>
      <DialogBody>
        {!loaded && (
          <div className="aw-center">
            <Spinner />
            <span className="aw-muted">Reading branches…</span>
          </div>
        )}
        {loaded && local.length === 0 && (
          <EmptyState
            icon={<Icons.BranchIcon size={22} />}
            title="No local branches"
            body="Check one out on the computer first."
          />
        )}
        {local.map((b) => (
          <SidebarItem
            key={b.name}
            leading={<Icons.BranchIcon size={12} />}
            active={b.name === current}
            count={
              b.name === current ? <Icons.CheckIcon size={12} /> : undefined
            }
            onClick={() => onPick(b.name)}
          >
            {b.name}
          </SidebarItem>
        ))}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
