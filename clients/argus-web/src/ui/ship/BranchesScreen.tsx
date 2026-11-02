/**
 * `/sessions/:id/git/branches`: the repository's branches, as the Mac's list.
 * A row's ⋯ (or right-click) opens its menu, a tap opens the branch, `New
 * branch` makes one. The computer only moves branches on a project root, so a
 * worktree session lists them read-only.
 */

import { useCallback, useState } from "react";
import {
  branchRef,
  branchSections,
  currentBranchName,
  filterBranches,
  INITIAL_LOAD,
  loadPhase,
} from "@argus/client-core";
import {
  Banner,
  BranchListRow,
  Button,
  ContextMenu,
  type ContextMenuItem,
  EmptyState,
  Icons,
  Input,
  SidebarSection,
  Spinner,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useBranchesStore } from "../../stores/branches";
import { useConnectionStore } from "../../stores/connection";
import { useHeldSession } from "../start/useHeldSession";
import { useLiveRefresh } from "../useLiveRefresh";
import { useBranchActions } from "./useBranchActions";

const EMPTY: never[] = [];

export function BranchesScreen({ sessionId }: { sessionId: string }) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const session = useHeldSession(sessionId);
  const branches = useBranchesStore((s) => s.bySession[sessionId] ?? EMPTY);
  const load = useBranchesStore(
    (s) => s.loadBySession[sessionId] ?? INITIAL_LOAD,
  );
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{
    items: ContextMenuItem[];
    x: number;
    y: number;
  } | null>(null);
  const canAct = hasControl && session?.kind === "project_root";
  const current = currentBranchName(branches);
  const actions = useBranchActions({
    sessionId,
    branches,
    canAct,
    onCompare: (b) =>
      current &&
      appNavigate({
        name: "compare",
        sessionId,
        left: current,
        right: branchRef(b),
      }),
  });

  const refresh = useCallback(() => {
    void useBranchesStore.getState().refresh(sessionId, { background: true });
  }, [sessionId]);
  useLiveRefresh(ready, refresh, 15_000);

  const filtered = filterBranches(branches, filter);
  const phase = loadPhase(load, filtered.length === 0);

  return (
    <div className="aw-ship">
      <div className="aw-ship-bar">
        <Input
          aria-label="Filter branches"
          placeholder="Filter branches"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {canAct && (
          <Button
            size="sm"
            variant="secondary"
            leading={<Icons.PlusIcon size={12} />}
            disabled={actions.busy}
            onClick={() => actions.newBranch()}
          >
            New branch
          </Button>
        )}
      </div>

      {hasControl && session && session.kind !== "project_root" && (
        <Banner tone="info">
          This session&apos;s worktree stays on its branch. Switch, merge and
          delete branches from the project&apos;s root session.
        </Banner>
      )}
      {actions.note && (
        <Banner
          tone={actions.note.error ? "error" : "success"}
          onDismiss={actions.clearNote}
        >
          {actions.note.text}
        </Banner>
      )}
      {load.error && branches.length > 0 && (
        <Banner tone="warning">{load.error}</Banner>
      )}

      {phase.kind === "loading" && (
        <div className="aw-center">
          <Spinner />
          <span className="aw-muted">Reading branches…</span>
        </div>
      )}
      {phase.kind === "failed" && (
        <EmptyState
          icon={<Icons.WarningIcon size={22} />}
          title="Couldn't read branches"
          body={phase.error}
        />
      )}
      {phase.kind === "empty" && (
        <EmptyState
          icon={<Icons.BranchIcon size={22} />}
          title="No branches"
          body={
            branches.length === 0
              ? "This repository has no branches yet."
              : "Nothing matches that filter."
          }
        />
      )}

      {branchSections(filtered).map((section) => (
        <div key={section.scope} className="aw-ship-section">
          <SidebarSection count={section.branches.length}>
            {section.title}
          </SidebarSection>
          <div className="aw-ship-list">
            {section.branches.map((b) => (
              <BranchListRow
                key={`${b.scope}:${b.name}`}
                branch={b}
                onClick={() =>
                  appNavigate({ name: "branch", sessionId, ref: branchRef(b) })
                }
                onMenu={(at) =>
                  setMenu({ ...at, items: actions.menuItems(b) })
                }
              />
            ))}
          </div>
        </div>
      ))}

      {menu && (
        <ContextMenu
          position={menu}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
      {actions.prompts}
    </div>
  );
}
