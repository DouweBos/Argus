import {
  Fragment,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { SearchIcon } from "../../icons/Icons";
import styles from "./GitToolbar.module.css";
import {
  CloudDownIcon,
  CloudUpIcon,
  ToolbarBranchIcon,
  ToolbarMergeIcon,
  ToolbarRedoIcon,
  ToolbarRefreshIcon,
  ToolbarStashIcon,
  ToolbarTagIcon,
  ToolbarUndoIcon,
} from "./toolbarIcons";

export interface GitToolbarAction {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export interface GitToolbarGroup {
  id: string;
  actions: GitToolbarAction[];
}

export interface GitToolbarProps {
  groups: GitToolbarGroup[];
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
}

export function GitToolbar({
  groups,
  searchPlaceholder = "Search",
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: GitToolbarProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
  };
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onSearchSubmit?.((e.target as HTMLInputElement).value);
    }
  };

  return (
    <div className={styles.toolbar}>
      {groups.map((group, gi) => (
        <Fragment key={group.id}>
          {gi > 0 && <span className={styles.divider} aria-hidden />}
          {group.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={styles.btn}
              title={a.label}
              aria-label={a.label}
              disabled={a.disabled}
              onClick={a.onClick}
            >
              {a.icon}
            </button>
          ))}
        </Fragment>
      ))}
      <span className={styles.spacer} />
      <label className={styles.search}>
        <SearchIcon size={11} />
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={searchValue ?? ""}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </label>
    </div>
  );
}

export interface DefaultGitToolbarHandlers {
  onPull?: () => void;
  onPush?: () => void;
  onStash?: () => void;
  onBranch?: () => void;
  onTag?: () => void;
  onMerge?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onRefresh?: () => void;
}

export interface DefaultGitToolbarDisabled {
  pull?: boolean;
  push?: boolean;
  stash?: boolean;
  branch?: boolean;
  tag?: boolean;
  merge?: boolean;
  undo?: boolean;
  redo?: boolean;
  refresh?: boolean;
}

/**
 * Build the canonical action set used in the Argus Git Panel.
 * Pass to {@link GitToolbar} as the `groups` prop.
 */
export function defaultGitToolbarGroups(
  handlers: DefaultGitToolbarHandlers = {},
  disabled: DefaultGitToolbarDisabled = {},
): GitToolbarGroup[] {
  const iconSize = 14;

  return [
    {
      id: "remote",
      actions: [
        {
          id: "pull",
          label: "Pull",
          icon: <CloudDownIcon size={iconSize} />,
          disabled: disabled.pull,
          onClick: handlers.onPull,
        },
        {
          id: "push",
          label: "Push",
          icon: <CloudUpIcon size={iconSize} />,
          disabled: disabled.push,
          onClick: handlers.onPush,
        },
      ],
    },
    {
      id: "refs",
      actions: [
        {
          id: "stash",
          label: "Stash",
          icon: <ToolbarStashIcon size={iconSize} />,
          disabled: disabled.stash,
          onClick: handlers.onStash,
        },
        {
          id: "branch",
          label: "Branch",
          icon: <ToolbarBranchIcon size={iconSize} />,
          disabled: disabled.branch,
          onClick: handlers.onBranch,
        },
        {
          id: "tag",
          label: "Tag",
          icon: <ToolbarTagIcon size={iconSize} />,
          disabled: disabled.tag,
          onClick: handlers.onTag,
        },
        {
          id: "merge",
          label: "Merge",
          icon: <ToolbarMergeIcon size={iconSize} />,
          disabled: disabled.merge,
          onClick: handlers.onMerge,
        },
      ],
    },
    {
      id: "history",
      actions: [
        {
          id: "undo",
          label: "Undo",
          icon: <ToolbarUndoIcon size={iconSize} />,
          disabled: disabled.undo,
          onClick: handlers.onUndo,
        },
        {
          id: "redo",
          label: "Redo",
          icon: <ToolbarRedoIcon size={iconSize} />,
          disabled: disabled.redo,
          onClick: handlers.onRedo,
        },
        {
          id: "refresh",
          label: "Refresh",
          icon: <ToolbarRefreshIcon size={iconSize} />,
          disabled: disabled.refresh,
          onClick: handlers.onRefresh,
        },
      ],
    },
  ];
}
