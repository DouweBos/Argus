import { useRef, useState } from "react";
import { BranchIcon, FolderIcon } from "../../icons/Icons";
import { Chip } from "../Chip/Chip";
import { PickerPopover } from "../PickerPopover/PickerPopover";
import styles from "./StartComposer.module.css";

/** Where the agent works: the checkout in front of you, a new worktree, or a branch that already exists. */
export type StartWorkspaceKind = "current" | "existing" | "worktree";

export interface StartWorkspaceChipProps {
  value: StartWorkspaceKind;
  onChange: (workspace: StartWorkspaceKind) => void;
  /** The workspaces on offer, in order. */
  options?: StartWorkspaceKind[];
  /** "Current checkout" on a project's root, "This worktree" in a session. */
  currentLabel: string;
  /** Branch the current checkout is on, shown under its option. */
  currentBranch?: string | null;
  /** The existing branch picked, shown on the chip. */
  existingBranch?: string | null;
  placement?: "above" | "below";
}

const ALL: StartWorkspaceKind[] = ["current", "worktree", "existing"];

function chipLabel(
  value: StartWorkspaceKind,
  currentLabel: string,
  existingBranch: string | null | undefined,
): string {
  if (value === "worktree") {
    return "New worktree";
  }
  if (value === "existing") {
    return existingBranch ? `On ${existingBranch}` : "Existing branch";
  }

  return currentLabel;
}

/** Where the agent about to start works. */
export function StartWorkspaceChip({
  value,
  onChange,
  options = ALL,
  currentLabel,
  currentBranch,
  existingBranch,
  placement,
}: StartWorkspaceChipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const pick = (workspace: StartWorkspaceKind) => {
    setOpen(false);
    onChange(workspace);
  };

  return (
    <div ref={anchorRef} className={styles.chipAnchor}>
      <Chip
        interactive
        aria-label="Where the agent works"
        leading={
          value === "current" ? (
            <FolderIcon size={11} />
          ) : (
            <BranchIcon size={11} />
          )
        }
        onClick={() => setOpen((o) => !o)}
      >
        {chipLabel(value, currentLabel, existingBranch)}
      </Chip>
      {open && (
        <PickerPopover
          placement={placement}
          triggerRef={anchorRef}
          onClose={() => setOpen(false)}
        >
          <PickerPopover.Header>Workspace</PickerPopover.Header>
          {options.includes("current") && (
            <PickerPopover.Option
              description={currentBranch ?? undefined}
              name={currentLabel}
              selected={value === "current"}
              onSelect={() => pick("current")}
            />
          )}
          {options.includes("worktree") && (
            <PickerPopover.Option
              description="A new branch, named from the prompt"
              name="New worktree"
              selected={value === "worktree"}
              onSelect={() => pick("worktree")}
            />
          )}
          {options.includes("existing") && (
            <PickerPopover.Option
              description="Check out a branch that already exists"
              name="Existing branch…"
              selected={value === "existing"}
              onSelect={() => pick("existing")}
            />
          )}
        </PickerPopover>
      )}
    </div>
  );
}

export interface BranchChipProps {
  /** The branch picked, or null for none yet. */
  value: string | null;
  options: string[];
  onChange: (branch: string) => void;
  loading?: boolean;
  /** What the chip reads with a branch picked; `from main` by default. */
  format?: (branch: string) => string;
  /** What it reads with none. */
  placeholder?: string;
  header?: string;
  title?: string;
  placement?: "above" | "below";
}

/** A branch to start from: the base a new worktree forks, or the existing branch to check out. */
export function BranchChip({
  value,
  options,
  onChange,
  loading = false,
  format = (branch) => `from ${branch}`,
  placeholder = "Pick base",
  header = "Base branch",
  title = "Branch the new worktree starts from",
  placement,
}: BranchChipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  let label = value ? format(value) : placeholder;
  if (!value && loading) {
    label = "Loading branches…";
  }

  return (
    <div ref={anchorRef} className={styles.chipAnchor}>
      <Chip
        interactive
        mono
        muted
        aria-label={header}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </Chip>
      {open && (
        <PickerPopover
          placement={placement}
          triggerRef={anchorRef}
          onClose={() => setOpen(false)}
        >
          <PickerPopover.Header>{header}</PickerPopover.Header>
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
