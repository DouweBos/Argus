import type { IssueDraft } from "./useIssueDraft";
import { useRef } from "react";
import { Chip, Icons, IssuePicker } from "@argus/peacock";
import styles from "./StartComposer.module.css";

/** The Linear chip that opens the picker, then one chip per attached issue. */
export function IssueChips({ draft }: { draft: IssueDraft }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!draft.connected) {
    return null;
  }

  return (
    <>
      <div ref={ref} className={styles.chipAnchor}>
        <Chip
          interactive
          muted={draft.issues.length === 0}
          aria-label="Attach Linear issues"
          leading={<Icons.LinearIcon size={11} />}
          title="Start from Linear issues — one agent each in a new worktree"
          onClick={draft.handleTogglePicker}
        >
          {draft.adding ? "Adding…" : "Issue"}
        </Chip>
        {draft.pickerOpen && (
          <IssuePicker
            error={draft.searchError}
            items={draft.results.map((i) => ({
              id: i.id,
              identifier: i.identifier,
              title: i.title,
              state: i.state.name,
            }))}
            loading={draft.searching}
            query={draft.query}
            selectedIds={draft.issues.map((c) => c.issue.id)}
            triggerRef={ref}
            onClose={draft.handleClosePicker}
            onQueryChange={draft.handleQueryChange}
            onToggle={draft.handleToggle}
          />
        )}
      </div>
      {draft.issues.map(({ issue }) => (
        <Chip
          key={issue.id}
          mono
          title={issue.title}
          onDismiss={() => draft.remove(issue.id)}
        >
          {issue.identifier}
        </Chip>
      ))}
    </>
  );
}
