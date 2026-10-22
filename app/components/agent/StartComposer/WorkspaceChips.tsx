import type { StartWorkspace } from "../../../stores/settingsStore";
import { useRef, useState } from "react";
import { Chip, Icons, PickerPopover } from "@argus/peacock";
import styles from "./StartComposer.module.css";

interface WorkspaceChipProps {
  /** Branch the current checkout is on, shown under its option. */
  currentBranch: string | null;
  /** "Current checkout" on a project's root, "This worktree" in a session. */
  currentLabel: string;
  onChange: (workspace: StartWorkspace) => void;
  /** Adopt a branch that already exists instead of forking a new one. */
  onPickExistingBranch: () => void;
  value: StartWorkspace;
}

/** Where the agent works: the checkout in front of you, or a fresh worktree. */
export function WorkspaceChip({
  currentBranch,
  currentLabel,
  onChange,
  onPickExistingBranch,
  value,
}: WorkspaceChipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const pick = (workspace: StartWorkspace) => {
    setOpen(false);
    onChange(workspace);
  };

  return (
    <div ref={anchorRef} className={styles.chipAnchor}>
      <Chip
        interactive
        aria-label="Where the agent works"
        leading={
          value === "worktree" ? (
            <Icons.BranchIcon size={11} />
          ) : (
            <Icons.FolderIcon size={11} />
          )
        }
        onClick={() => setOpen((o) => !o)}
      >
        {value === "worktree" ? "New worktree" : currentLabel}
      </Chip>
      {open && (
        <PickerPopover triggerRef={anchorRef} onClose={() => setOpen(false)}>
          <PickerPopover.Header>Workspace</PickerPopover.Header>
          <PickerPopover.Option
            name={currentLabel}
            description={currentBranch ?? undefined}
            selected={value === "current"}
            onSelect={() => pick("current")}
          />
          <PickerPopover.Option
            name="New worktree"
            description="A new branch, named from the prompt"
            selected={value === "worktree"}
            onSelect={() => pick("worktree")}
          />
          <PickerPopover.Option
            name="Existing branch…"
            description="Check out a branch that already exists"
            onSelect={() => {
              setOpen(false);
              onPickExistingBranch();
            }}
          />
        </PickerPopover>
      )}
    </div>
  );
}

function baseChipLabel(value: string | null, loading: boolean): string {
  if (value) {
    return `from ${value}`;
  }

  return loading ? "Loading branches…" : "Pick base";
}

interface BaseBranchChipProps {
  loading: boolean;
  onChange: (branch: string) => void;
  options: string[];
  value: string | null;
}

/** The branch a new worktree forks from. */
export function BaseBranchChip({
  loading,
  onChange,
  options,
  value,
}: BaseBranchChipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={anchorRef} className={styles.chipAnchor}>
      <Chip
        interactive
        mono
        muted
        aria-label="Base branch"
        title="Branch the new worktree starts from"
        onClick={() => setOpen((o) => !o)}
      >
        {baseChipLabel(value, loading)}
      </Chip>
      {open && (
        <PickerPopover triggerRef={anchorRef} onClose={() => setOpen(false)}>
          <PickerPopover.Header>Base branch</PickerPopover.Header>
          {options.length === 0 ? (
            <PickerPopover.Empty>
              {loading ? "Loading branches…" : "No branches"}
            </PickerPopover.Empty>
          ) : (
            options.map((branch) => (
              <PickerPopover.Option
                key={branch}
                name={branch}
                selected={branch === value}
                onSelect={() => {
                  setOpen(false);
                  onChange(branch);
                }}
              />
            ))
          )}
        </PickerPopover>
      )}
    </div>
  );
}
