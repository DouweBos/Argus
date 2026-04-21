import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icons, Kbd, useDismissOnEscape } from "@argus/peacock";
import { useProjects } from "../../../hooks/useSessions";
import { startAgentInSession } from "../../../lib/agentLifecycle";
import {
  gitFetch,
  gitPull,
  gitPush,
  gitStash,
  interruptAgent,
  mergeSessionIntoBase,
  revealInFinder,
} from "../../../lib/ipc";
import { shortcutKeys } from "../../../lib/shortcuts";
import {
  cycleActiveAgent,
  getActiveAgent,
  useAgentsRecord,
} from "../../../stores/agentStore";
import { showBranchPicker } from "../../../stores/branchPickerStore";
import {
  closeCommandPalette,
  useCommandPaletteOpen,
} from "../../../stores/commandPaletteStore";
import { useConversations } from "../../../stores/conversationStore";
import {
  showOpenProjectDialog,
  triggerNewSession,
} from "../../../stores/dialogStore";
import {
  toggleLeftSidebar,
  toggleRightPanel,
  toggleTool,
  type ToolId,
} from "../../../stores/layoutStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import {
  selectSession,
  useSelectedSessionId,
  useSessions,
} from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import styles from "./CommandPalette.module.css";

type PaletteGroup =
  | "action"
  | "git"
  | "navigation"
  | "project"
  | "session"
  | "sessions"
  | "view";

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
  session: "Session",
  git: "Git",
  project: "Recent projects",
  sessions: "Sessions",
};

const GROUP_ORDER: PaletteGroup[] = [
  "action",
  "navigation",
  "view",
  "session",
  "git",
  "project",
  "sessions",
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
  const sessions = useSessions();
  const selectedId = useSelectedSessionId();
  // Subscribing keeps the agent-dependent actions in sync.
  const agentsRecord = useAgentsRecord();
  const conversations = useConversations();
  const { openProject } = useProjects();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  useDismissOnEscape(closeCommandPalette);

  const selectedSession = useMemo(
    () => sessions.find((w) => w.id === selectedId) ?? null,
    [sessions, selectedId],
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
        hint: shortcutKeys("settings"),
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
        hint: shortcutKeys("open-repo"),
        run: () => {
          closeCommandPalette();
          showOpenProjectDialog();
        },
      },
      {
        group: "action",
        id: "action:new-session",
        title: "New session…",
        sublabel: "Create a worktree from a branch",
        icon: <Icons.PlusIcon size={13} />,
        keywords: "new session branch worktree create",
        hint: shortcutKeys("new-session"),
        run: () => {
          closeCommandPalette();
          triggerNewSession();
        },
      },
    );

    out.push(
      {
        group: "view",
        id: "view:toggle-left",
        title: "Toggle left sidebar",
        icon: <Icons.FolderIcon size={13} />,
        keywords: "toggle left sidebar panel session hide show",
        hint: shortcutKeys("toggle-left-sidebar"),
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
        hint: shortcutKeys("toggle-right-panel"),
        run: () => {
          closeCommandPalette();
          toggleRightPanel();
        },
      },
    );

    if (selectedSession) {
      const wsId = selectedSession.id;
      const activeAgent = getActiveAgent(wsId);

      const projectHead = sessions.find(
        (w) =>
          w.repo_root === selectedSession.repo_root &&
          w.kind === "project_root",
      );

      out.push(
        {
          group: "navigation",
          id: "nav:home",
          title: "Go to app home",
          sublabel: "Deselect this session",
          icon: <Icons.ArgusLogo size={13} />,
          keywords: "home app deselect close exit session",
          hint: shortcutKeys("go-home"),
          run: () => {
            closeCommandPalette();
            selectSession(null);
          },
        },
        ...(projectHead && projectHead.id !== wsId
          ? [
              {
                group: "navigation" as const,
                id: "nav:project-home",
                title: "Go to project home",
                sublabel: `${basename(selectedSession.repo_root)} · ${projectHead.branch}`,
                icon: <Icons.FolderIcon size={13} />,
                keywords: "project home root repo head main master",
                hint: shortcutKeys("go-project-home"),
                run: () => {
                  closeCommandPalette();
                  selectSession(projectHead.id);
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
        group: "session",
        id: "ws:switch-branch",
        title: "Switch branch…",
        sublabel: `current: ${selectedSession.branch}`,
        icon: <Icons.ArgusLogo size={13} />,
        keywords: "switch checkout branch change head",
        run: () => {
          closeCommandPalette();
          showBranchPicker(selectedSession.repo_root, wsId);
        },
      });

      out.push({
        group: "session",
        id: "ws:new-agent",
        title: "Start new agent",
        sublabel: `in ${selectedSession.branch}`,
        icon: <Icons.PlusIcon size={13} />,
        keywords: "new agent claude start",
        hint: shortcutKeys("new-agent"),
        run: () => {
          closeCommandPalette();
          startAgentInSession(wsId).catch(() => {});
        },
      });

      const wsAgentCount = Object.values(agentsRecord).filter(
        (a) => a.session_id === wsId,
      ).length;
      if (wsAgentCount >= 2) {
        out.push(
          {
            group: "navigation",
            id: "nav:next-agent",
            title: "Next agent tab",
            icon: <Icons.ArgusLogo size={13} />,
            keywords: "next agent tab cycle switch",
            hint: shortcutKeys("next-agent-tab"),
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
            hint: shortcutKeys("prev-agent-tab"),
            run: () => {
              closeCommandPalette();
              cycleActiveAgent(wsId, -1);
            },
          },
        );
      }

      if (activeAgent) {
        const activeTitle =
          conversations[activeAgent.agent_id]?.title?.trim() ||
          `Agent ${activeAgent.agent_id.slice(0, 6)}`;
        out.push({
          group: "session",
          id: "ws:interrupt-agent",
          title: "Interrupt active agent",
          sublabel: activeTitle,
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
          group: "session",
          id: "ws:reveal",
          title: "Reveal worktree in Finder",
          sublabel: selectedSession.path,
          icon: <Icons.FolderIcon size={13} />,
          keywords: "reveal finder open folder worktree path",
          run: () => {
            closeCommandPalette();
            revealInFinder(selectedSession.path).catch(() => {});
          },
        },
        {
          group: "session",
          id: "ws:copy-path",
          title: "Copy worktree path",
          sublabel: selectedSession.path,
          icon: <Icons.FolderIcon size={13} />,
          keywords: "copy path clipboard worktree",
          run: () => {
            closeCommandPalette();
            navigator.clipboard.writeText(selectedSession.path).catch(() => {});
          },
        },
      );

      if (selectedSession.kind === "worktree") {
        out.push({
          group: "session",
          id: "ws:merge",
          title: "Merge into base branch",
          sublabel: `${selectedSession.branch} → ${selectedSession.base_branch ?? "base"}`,
          icon: <Icons.ArgusLogo size={13} />,
          keywords: "merge base branch worktree",
          run: () => {
            closeCommandPalette();
            mergeSessionIntoBase(wsId).catch(() => {});
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

    sessions.forEach((w) => {
      if (w.id === selectedId) {
        return;
      }
      out.push({
        group: "sessions",
        id: `session:${w.id}`,
        title: w.branch,
        sublabel: basename(w.repo_root),
        icon: <Icons.ArgusLogo size={13} />,
        keywords: `${w.branch} ${w.repo_root} session switch`,
        run: () => {
          closeCommandPalette();
          selectSession(w.id);
        },
      });
    });

    return out;
  }, [
    recent,
    sessions,
    selectedId,
    selectedSession,
    openProject,
    agentsRecord,
    conversations,
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

  const groups = useMemo(() => groupItems(filtered), [filtered]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const safeIndex = Math.min(Math.max(activeIndex, 0), ordered.length - 1);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

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
      setActiveIndex(Math.min(safeIndex + 1, ordered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(safeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = ordered[safeIndex];
      if (pick) {
        runPick(pick);
      }
    }
  };

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
            placeholder="Open repo · switch session · run command"
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
                const globalIdx = ordered.indexOf(it);
                const active = globalIdx === safeIndex;

                return (
                  <button
                    key={it.id}
                    ref={active ? activeItemRef : undefined}
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
