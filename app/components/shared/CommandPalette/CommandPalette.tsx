import { useMemo, useRef, useState, type ReactNode } from "react";
import { Icons, Kbd, useDismissOnEscape } from "@argus/peacock";
import { useProjects } from "../../../hooks/useWorkspaces";
import {
  gitFetch,
  gitPull,
  gitPush,
  gitStash,
  interruptAgent,
  mergeWorkspaceIntoBase,
  revealInFinder,
  startAgent,
} from "../../../lib/ipc";
import {
  addAgent,
  cycleActiveAgent,
  getActiveAgent,
  useAgentsRecord,
} from "../../../stores/agentStore";
import { showBranchPicker } from "../../../stores/branchPickerStore";
import {
  closeCommandPalette,
  useCommandPaletteOpen,
} from "../../../stores/commandPaletteStore";
import {
  showOpenProjectDialog,
  triggerNewWorkspace,
} from "../../../stores/dialogStore";
import {
  toggleLeftSidebar,
  toggleRightPanel,
  toggleTool,
  type ToolId,
} from "../../../stores/layoutStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import {
  selectWorkspace,
  useSelectedWorkspaceId,
  useWorkspaces,
} from "../../../stores/workspaceStore";
import styles from "./CommandPalette.module.css";

type PaletteGroup =
  | "action"
  | "git"
  | "navigation"
  | "project"
  | "view"
  | "workspace"
  | "workspaces";

interface PaletteItem {
  group: PaletteGroup;
  hint?: string[];
  icon: ReactNode;
  id: string;
  keywords: string;
  run: () => void;
  sublabel?: string;
  title: string;
}

const GROUP_LABELS: Record<PaletteGroup, string> = {
  action: "Actions",
  navigation: "Navigation",
  view: "View",
  workspace: "Workspace",
  git: "Git",
  project: "Recent projects",
  workspaces: "Workspaces",
};

const GROUP_ORDER: PaletteGroup[] = [
  "action",
  "navigation",
  "view",
  "workspace",
  "git",
  "project",
  "workspaces",
];

export function CommandPalette() {
  const open = useCommandPaletteOpen();
  if (!open) {
    return null;
  }

  return <CommandPaletteContent />;
}

function CommandPaletteContent() {
  const recent = useRecentProjects();
  const workspaces = useWorkspaces();
  const selectedId = useSelectedWorkspaceId();
  // Subscribing keeps the agent-dependent actions in sync.
  const agentsRecord = useAgentsRecord();
  const { openProject } = useProjects();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useDismissOnEscape(closeCommandPalette);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedId) ?? null,
    [workspaces, selectedId],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];

    out.push(
      {
        group: "action",
        id: "action:settings",
        title: "Open settings",
        sublabel: "Default permission mode and more",
        icon: <Icons.FolderIcon size={13} />,
        keywords: "settings preferences config options",
        hint: ["⌘", ","],
        run: () => {
          closeCommandPalette();
          showSettingsDialog();
        },
      },
      {
        group: "action",
        id: "action:open-repo",
        title: "Open repository…",
        sublabel: "Pick a folder on disk",
        icon: <Icons.FolderIcon size={13} />,
        keywords: "open repo repository folder add",
        hint: ["⌘", "O"],
        run: () => {
          closeCommandPalette();
          showOpenProjectDialog();
        },
      },
      {
        group: "action",
        id: "action:new-workspace",
        title: "New workspace…",
        sublabel: "Create a worktree from a branch",
        icon: <Icons.PlusIcon size={13} />,
        keywords: "new workspace branch worktree create",
        hint: ["⌘", "N"],
        run: () => {
          closeCommandPalette();
          triggerNewWorkspace();
        },
      },
    );

    out.push(
      {
        group: "view",
        id: "view:toggle-left",
        title: "Toggle left sidebar",
        icon: <Icons.FolderIcon size={13} />,
        keywords: "toggle left sidebar panel workspace hide show",
        hint: ["⌘", "B"],
        run: () => {
          closeCommandPalette();
          toggleLeftSidebar();
        },
      },
      {
        group: "view",
        id: "view:toggle-right",
        title: "Toggle right panel",
        icon: <Icons.FolderIcon size={13} />,
        keywords: "toggle right panel tool terminal simulator hide show",
        hint: ["⌘", "⌥", "B"],
        run: () => {
          closeCommandPalette();
          toggleRightPanel();
        },
      },
    );

    if (selectedWorkspace) {
      const wsId = selectedWorkspace.id;
      const activeAgent = getActiveAgent(wsId);

      const projectHead = workspaces.find(
        (w) =>
          w.repo_root === selectedWorkspace.repo_root && w.kind === "repo_root",
      );

      out.push(
        {
          group: "navigation",
          id: "nav:home",
          title: "Go to app home",
          sublabel: "Deselect this workspace",
          icon: <Icons.ArgusLogo size={13} />,
          keywords: "home app deselect close exit workspace",
          hint: ["⌘", "⇧", "H"],
          run: () => {
            closeCommandPalette();
            selectWorkspace(null);
          },
        },
        ...(projectHead && projectHead.id !== wsId
          ? [
              {
                group: "navigation" as const,
                id: "nav:project-home",
                title: "Go to project home",
                sublabel: `${basename(selectedWorkspace.repo_root)} · ${projectHead.branch}`,
                icon: <Icons.FolderIcon size={13} />,
                keywords: "project home root repo head main master",
                hint: ["⌘", "⌥", "H"],
                run: () => {
                  closeCommandPalette();
                  selectWorkspace(projectHead.id);
                },
              } satisfies PaletteItem,
            ]
          : []),
        ...(["terminal", "changes", "simulator"] as ToolId[]).map<PaletteItem>(
          (id) => ({
            group: "view",
            id: `view:tool:${id}`,
            title: `Show ${id}`,
            icon: <Icons.FolderIcon size={13} />,
            keywords: `tool panel show ${id}`,
            run: () => {
              closeCommandPalette();
              toggleTool(id);
            },
          }),
        ),
      );

      out.push({
        group: "workspace",
        id: "ws:switch-branch",
        title: "Switch branch…",
        sublabel: `current: ${selectedWorkspace.branch}`,
        icon: <Icons.ArgusLogo size={13} />,
        keywords: "switch checkout branch change head",
        run: () => {
          closeCommandPalette();
          showBranchPicker(selectedWorkspace.repo_root, wsId);
        },
      });

      out.push({
        group: "workspace",
        id: "ws:new-agent",
        title: "Start new agent",
        sublabel: `in ${selectedWorkspace.branch}`,
        icon: <Icons.PlusIcon size={13} />,
        keywords: "new agent claude start",
        hint: ["⌘", "⇧", "A"],
        run: () => {
          closeCommandPalette();
          startAgent(wsId)
            .then((info) =>
              addAgent({
                agent_id: info.agent_id,
                workspace_id: info.workspace_id,
                status: "running",
              }),
            )
            .catch(() => {});
        },
      });

      const wsAgentCount = Object.values(agentsRecord).filter(
        (a) => a.workspace_id === wsId,
      ).length;
      if (wsAgentCount >= 2) {
        out.push(
          {
            group: "navigation",
            id: "nav:next-agent",
            title: "Next agent tab",
            icon: <Icons.ArgusLogo size={13} />,
            keywords: "next agent tab cycle switch",
            hint: ["⌘", "⇧", "]"],
            run: () => {
              closeCommandPalette();
              cycleActiveAgent(wsId, 1);
            },
          },
          {
            group: "navigation",
            id: "nav:prev-agent",
            title: "Previous agent tab",
            icon: <Icons.ArgusLogo size={13} />,
            keywords: "previous prev agent tab cycle switch",
            hint: ["⌘", "⇧", "["],
            run: () => {
              closeCommandPalette();
              cycleActiveAgent(wsId, -1);
            },
          },
        );
      }

      if (activeAgent) {
        out.push({
          group: "workspace",
          id: "ws:interrupt-agent",
          title: "Interrupt active agent",
          sublabel: activeAgent.agent_id.slice(0, 8),
          icon: <Icons.CloseIcon size={13} />,
          keywords: "stop interrupt cancel agent active",
          run: () => {
            closeCommandPalette();
            interruptAgent(activeAgent.agent_id).catch(() => {});
          },
        });
      }

      out.push(
        {
          group: "workspace",
          id: "ws:reveal",
          title: "Reveal worktree in Finder",
          sublabel: selectedWorkspace.path,
          icon: <Icons.FolderIcon size={13} />,
          keywords: "reveal finder open folder worktree path",
          run: () => {
            closeCommandPalette();
            revealInFinder(selectedWorkspace.path).catch(() => {});
          },
        },
        {
          group: "workspace",
          id: "ws:copy-path",
          title: "Copy worktree path",
          sublabel: selectedWorkspace.path,
          icon: <Icons.FolderIcon size={13} />,
          keywords: "copy path clipboard worktree",
          run: () => {
            closeCommandPalette();
            navigator.clipboard
              .writeText(selectedWorkspace.path)
              .catch(() => {});
          },
        },
      );

      if (selectedWorkspace.kind === "worktree") {
        out.push({
          group: "workspace",
          id: "ws:merge",
          title: "Merge into base branch",
          sublabel: `${selectedWorkspace.branch} → ${selectedWorkspace.base_branch ?? "base"}`,
          icon: <Icons.ArgusLogo size={13} />,
          keywords: "merge base branch worktree",
          run: () => {
            closeCommandPalette();
            mergeWorkspaceIntoBase(wsId).catch(() => {});
          },
        });
      }

      out.push(
        {
          group: "git",
          id: "git:pull",
          title: "Git pull",
          icon: <Icons.FolderIcon size={13} />,
          keywords: "git pull fetch merge upstream",
          run: () => {
            closeCommandPalette();
            gitPull(wsId).catch(() => {});
          },
        },
        {
          group: "git",
          id: "git:push",
          title: "Git push",
          icon: <Icons.FolderIcon size={13} />,
          keywords: "git push upstream remote",
          run: () => {
            closeCommandPalette();
            gitPush(wsId).catch(() => {});
          },
        },
        {
          group: "git",
          id: "git:fetch",
          title: "Git fetch",
          icon: <Icons.FolderIcon size={13} />,
          keywords: "git fetch remote",
          run: () => {
            closeCommandPalette();
            gitFetch(wsId).catch(() => {});
          },
        },
        {
          group: "git",
          id: "git:stash",
          title: "Git stash",
          icon: <Icons.FolderIcon size={13} />,
          keywords: "git stash save shelve",
          run: () => {
            closeCommandPalette();
            gitStash(wsId).catch(() => {});
          },
        },
      );
    }

    recent.forEach((p) => {
      out.push({
        group: "project",
        id: `project:${p.path}`,
        title: p.name,
        sublabel: p.path,
        icon: <Icons.FolderIcon size={13} />,
        keywords: `${p.name} ${p.path} repo project open`,
        run: () => {
          closeCommandPalette();
          openProject(p.path).catch(() => {});
        },
      });
    });

    workspaces.forEach((w) => {
      if (w.id === selectedId) {
        return;
      }
      out.push({
        group: "workspaces",
        id: `workspace:${w.id}`,
        title: w.branch,
        sublabel: basename(w.repo_root),
        icon: <Icons.ArgusLogo size={13} />,
        keywords: `${w.branch} ${w.repo_root} workspace switch`,
        run: () => {
          closeCommandPalette();
          selectWorkspace(w.id);
        },
      });
    });

    return out;
  }, [
    recent,
    workspaces,
    selectedId,
    selectedWorkspace,
    openProject,
    agentsRecord,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items;
    }

    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.keywords.toLowerCase().includes(q) ||
        (it.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  const safeIndex = Math.min(Math.max(activeIndex, 0), filtered.length - 1);

  const onOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeCommandPalette();
    }
  };

  const runPick = (item: PaletteItem) => {
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(safeIndex + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(safeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[safeIndex];
      if (pick) {
        runPick(pick);
      }
    }
  };

  const groups = groupItems(filtered);

  return (
    <div
      className={styles.overlay}
      onClick={onOverlayClick}
      role="presentation"
    >
      <div
        aria-label="Command palette"
        aria-modal="true"
        className={styles.palette}
        role="dialog"
      >
        <div className={styles.searchRow}>
          <span className={styles.slash}>/</span>
          <input
            ref={inputRef}
            aria-label="Search commands"
            autoComplete="off"
            autoFocus
            className={styles.input}
            placeholder="Open repo · switch workspace · run command"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Kbd keys={["esc"]} />
        </div>

        <div className={styles.results}>
          {filtered.length === 0 && (
            <div className={styles.empty}>No matches.</div>
          )}
          {groups.map((g) => (
            <div key={g.key} className={styles.group}>
              <div className={styles.groupHead}>{g.label}</div>
              {g.items.map((it) => {
                const globalIdx = filtered.indexOf(it);
                const active = globalIdx === safeIndex;

                return (
                  <button
                    key={it.id}
                    className={`${styles.item} ${active ? styles.itemActive : ""}`}
                    type="button"
                    onClick={() => runPick(it)}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                  >
                    <span className={styles.itemIcon}>{it.icon}</span>
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{it.title}</span>
                      {it.sublabel && (
                        <span className={styles.itemSub}>{it.sublabel}</span>
                      )}
                    </span>
                    {it.hint && <Kbd keys={it.hint} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function groupItems(items: PaletteItem[]) {
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    items: items.filter((it) => it.group === key),
  })).filter((g) => g.items.length > 0);
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
