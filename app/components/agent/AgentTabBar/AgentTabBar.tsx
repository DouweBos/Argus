import type { DropPosition } from "../../../hooks/useTabReorder";
import type { AgentStatus } from "../../../lib/types";
import type { SplitPair } from "../../../stores/agentStore";
import type { StatusDotsState } from "@argus/peacock";
import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  ContextMenu,
  type ContextMenuItem,
  Icons,
  StatusDots,
} from "@argus/peacock";
import { useTabReorder } from "../../../hooks/useTabReorder";
import { saveAgentConversation } from "../../../lib/agentEventService";
import {
  interruptAgent,
  openAgentPopout,
  revealInFinder,
} from "../../../lib/ipc";
import {
  reorderAgent,
  useAgentsRecord,
  usePoppedOutAgents,
} from "../../../stores/agentStore";
import {
  clearAgentUnread,
  getConversationState,
  useAgentHasUnread,
  useConversation,
} from "../../../stores/conversationStore";
import { getSessionState } from "../../../stores/sessionStore";
import { RenameAgentDialog } from "../RenameAgentDialog/RenameAgentDialog";
import {
  AGENT_DRAG_MIME,
  beginAgentDrag,
  endAgentDrag,
} from "../agentDragDrop";
import styles from "./AgentTabBar.module.css";

interface AgentTabBarProps {
  activeAgentId: string | null;
  agents: AgentStatus[];
  onClose: (agentId: string) => void;
  onSelect: (agentId: string) => void;
  onUnpair?: () => void;
  splitPair?: SplitPair | null;
}

function useTabMeta(
  agentId: string,
  fallback: string,
  status: AgentStatus["status"],
  hasUnread: boolean,
): { fullLabel: string; label: string; state: StatusDotsState } {
  const conv = useConversation(agentId);
  const messages = conv?.messages ?? [];

  // When the unread dot is shown, drop the trailing ellipsis on truncated
  // titles \u2014 the dot already indicates the tab needs attention and the
  // dot+ellipsis pairing reads as visual noise.
  const truncationSuffix = hasUnread ? "" : "\u2026";

  let label = fallback;
  let fullLabel = fallback;
  if (conv?.title) {
    const title = conv.title.trim();
    fullLabel = title;
    label = title.length > 24 ? title.slice(0, 24) + truncationSuffix : title;
  } else {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser && firstUser.textBlocks.length > 0) {
      const text = firstUser.textBlocks[0].trim();
      fullLabel = text;
      label = text.length > 20 ? text.slice(0, 20) + truncationSuffix : text;
    }
  }

  const awaitingPermission = messages.some((m) =>
    m.toolCalls.some((tc) => tc.pendingPermission),
  );

  let state: StatusDotsState = "idle";
  if (awaitingPermission) {
    state = "awaiting";
  } else if (status === "running") {
    state = "running";
  }

  return { fullLabel, label, state };
}

function AgentTab({
  agent,
  index,
  isActive,
  isSecondary,
  childCount,
  hasParent,
  isDragging,
  dropIndicator,
  tabRef,
  onSelect,
  onClose,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  agent: AgentStatus;
  childCount: number;
  dropIndicator: DropPosition | null;
  hasParent: boolean;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  isSecondary: boolean;
  onClose: (id: string) => void;
  onContextMenu: (e: ReactMouseEvent, id: string) => void;
  onDragEnd: () => void;
  onDragLeave: (id: string) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onSelect: (id: string) => void;
  tabRef: (el: HTMLDivElement | null) => void;
}) {
  const hasUnread = useAgentHasUnread(agent.agent_id);
  const { fullLabel, label, state } = useTabMeta(
    agent.agent_id,
    `Agent ${index + 1}`,
    agent.status,
    hasUnread,
  );

  const classes = [
    styles.tab,
    isActive ? styles.active : null,
    isSecondary ? styles.secondary : null,
    isDragging ? styles.dragging : null,
    dropIndicator === "before" ? styles.dropBefore : null,
    dropIndicator === "after" ? styles.dropAfter : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={tabRef}
      className={classes}
      draggable
      title={fullLabel}
      onAuxClick={(e) => {
        if (e.button !== 1) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onClose(agent.agent_id);
      }}
      onClick={() => onSelect(agent.agent_id)}
      onContextMenu={(e) => onContextMenu(e, agent.agent_id)}
      onDragStart={(e) => onDragStart(e, agent.agent_id)}
      onDragEnd={() => onDragEnd()}
      onDragOver={(e) => onDragOver(e, agent.agent_id)}
      onDragLeave={() => onDragLeave(agent.agent_id)}
      onDrop={(e) => onDrop(e, agent.agent_id)}
    >
      <StatusDots state={state} className={styles.statusDots} />
      {hasParent && (
        <span className={styles.parentBadge} title="Spawned by another agent">
          &#8618;
        </span>
      )}
      <span className={styles.label}>{label}</span>
      {hasUnread && (
        <span
          aria-label="Unread messages"
          className={styles.unreadDot}
          title="Unread messages"
        />
      )}
      {childCount > 0 && (
        <Badge
          tone="accent"
          size="pill"
          title={`${childCount} child agent${childCount > 1 ? "s" : ""}`}
        >
          {childCount}
        </Badge>
      )}
      <button
        className={styles.closeBtn}
        title="Close agent"
        onClick={(e) => {
          e.stopPropagation();
          onClose(agent.agent_id);
        }}
      >
        <Icons.CloseIcon size={10} />
      </button>
    </div>
  );
}

function MergedAgentTab({
  left,
  right,
  leftIndex,
  rightIndex,
  activeAgentId,
  dropIndicator,
  tabRef,
  onSelect,
  onUnpair,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  activeAgentId: string | null;
  dropIndicator: DropPosition | null;
  left: AgentStatus;
  leftIndex: number;
  onDragLeave: (id: string) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onSelect: (id: string) => void;
  onUnpair?: () => void;
  right: AgentStatus;
  rightIndex: number;
  tabRef: (el: HTMLDivElement | null) => void;
}) {
  const leftUnread = useAgentHasUnread(left.agent_id);
  const rightUnread = useAgentHasUnread(right.agent_id);
  const leftMeta = useTabMeta(
    left.agent_id,
    `Agent ${leftIndex + 1}`,
    left.status,
    leftUnread,
  );
  const rightMeta = useTabMeta(
    right.agent_id,
    `Agent ${(rightIndex >= 0 ? rightIndex : leftIndex + 1) + 1}`,
    right.status,
    rightUnread,
  );

  const anyActive =
    activeAgentId === left.agent_id || activeAgentId === right.agent_id;

  const classes = [
    styles.tab,
    styles.mergedTab,
    anyActive ? styles.active : null,
    dropIndicator === "before" ? styles.dropBefore : null,
    dropIndicator === "after" ? styles.dropAfter : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={tabRef}
      className={classes}
      title={`${leftMeta.fullLabel} · ${rightMeta.fullLabel}`}
      onDragOver={(e) => onDragOver(e, left.agent_id)}
      onDragLeave={() => onDragLeave(left.agent_id)}
      onDrop={(e) => onDrop(e, left.agent_id)}
    >
      <div
        className={styles.mergedHalf}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(left.agent_id);
        }}
      >
        <StatusDots state={leftMeta.state} className={styles.statusDots} />
        <span className={styles.label}>{leftMeta.label}</span>
        {leftUnread && (
          <span
            aria-label="Unread messages"
            className={styles.unreadDot}
            title="Unread messages"
          />
        )}
      </div>
      <span className={styles.mergedDivider} aria-hidden />
      <div
        className={styles.mergedHalf}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(right.agent_id);
        }}
      >
        <StatusDots state={rightMeta.state} className={styles.statusDots} />
        <span className={styles.label}>{rightMeta.label}</span>
        {rightUnread && (
          <span
            aria-label="Unread messages"
            className={styles.unreadDot}
            title="Unread messages"
          />
        )}
      </div>
      {onUnpair && (
        <button
          className={styles.mergedUnpairBtn}
          title="Unmerge split tab"
          onClick={(e) => {
            e.stopPropagation();
            onUnpair();
          }}
        >
          <Icons.CloseIcon size={10} />
        </button>
      )}
    </div>
  );
}

export function AgentTabBar({
  agents: rawAgents,
  activeAgentId,
  splitPair = null,
  onSelect,
  onClose,
  onUnpair,
}: AgentTabBarProps) {
  const allAgents = useAgentsRecord();
  const poppedOut = usePoppedOutAgents();
  // Detached agents render in their own window, so hide them from the tab
  // bar. `AgentView` still sees them in its unfiltered list — it's responsible
  // for clearing an active selection that just popped out.
  const agents = useMemo(
    () => rawAgents.filter((a) => !poppedOut[a.agent_id]),
    [rawAgents, poppedOut],
  );
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setTabRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) {
        tabRefs.current.set(id, el);
      } else {
        tabRefs.current.delete(id);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeAgentId) {
      return;
    }
    const el = tabRefs.current.get(activeAgentId);
    if (el) {
      el.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeAgentId, agents.length]);

  const reorderForTarget = useCallback(
    (fromId: string, targetId: string, position: DropPosition) => {
      const target = agents.find((a) => a.agent_id === targetId);
      if (!target) {
        return;
      }
      reorderAgent(target.session_id, fromId, targetId, position);
    },
    [agents],
  );

  const {
    draggingId,
    getIndicator,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useTabReorder({
    mime: AGENT_DRAG_MIME,
    onDragEnd: endAgentDrag,
    onDragStart: beginAgentDrag,
    onReorder: reorderForTarget,
  });

  const [menuState, setMenuState] = useState<{
    agentId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    agentId: string;
    currentTitle: string;
  } | null>(null);

  const closeMenu = useCallback(() => setMenuState(null), []);

  const handleContextMenu = useCallback((e: ReactMouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({
      agentId: id,
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menuState) {
      return [];
    }
    const targetId = menuState.agentId;
    const targetIndex = agents.findIndex((a) => a.agent_id === targetId);
    if (targetIndex < 0) {
      return [];
    }
    const others = agents.filter(
      (a) =>
        a.agent_id !== targetId &&
        (a.status === "idle" || a.status === "stopped"),
    );
    const toLeft = agents.slice(0, targetIndex);
    const toRight = agents.slice(targetIndex + 1);
    const idle = agents.filter(
      (a) => a.status === "idle" || a.status === "stopped",
    );
    const closeMany = (ids: string[]) => {
      for (const id of ids) {
        onClose(id);
      }
    };

    const target = agents[targetIndex];
    const conv = getConversationState().conversations[targetId];
    // Number by the agent's stable position in the unfiltered session order
    // so detaching a sibling into a popout window doesn't renumber the rest.
    const stableIndex = rawAgents.findIndex((a) => a.agent_id === targetId);
    const fallbackTitle = `Agent ${(stableIndex < 0 ? targetIndex : stableIndex) + 1}`;
    const firstUserText = conv?.messages.find((m) => m.role === "user")
      ?.textBlocks[0];
    const currentTitle =
      conv?.title?.trim() || firstUserText?.trim() || fallbackTitle;
    const session = getSessionState().sessions.find(
      (w) => w.id === target.session_id,
    );
    const isRunning = target.status === "running";
    const convState = getConversationState();
    const hasUnreadForTarget =
      (convState.unreadMessages[targetId]?.size ?? 0) > 0 ||
      (convState.pendingUnread[targetId]?.size ?? 0) > 0;

    return [
      {
        label: "Rename Agent\u2026",
        onClick: () => setRenameTarget({ agentId: targetId, currentTitle }),
      },
      {
        label: "Copy Agent ID",
        onClick: () => {
          navigator.clipboard.writeText(targetId).catch(() => {});
        },
      },
      {
        label: "Mark as Read",
        disabled: !hasUnreadForTarget,
        onClick: () => clearAgentUnread(targetId),
      },
      { separator: true },
      {
        label: "Stop Agent",
        disabled: !isRunning,
        onClick: () => {
          interruptAgent(targetId).catch(() => {});
        },
      },
      {
        label: "Open in New Window",
        onClick: () => {
          // Flush the current in-memory conversation to the backend first
          // so the freshly opened popout can hydrate from it — the
          // debounced save in `scheduleAgentSave` may not have fired yet.
          saveAgentConversation(targetId);
          openAgentPopout({
            agentId: targetId,
            sessionId: target.session_id,
            title: currentTitle || undefined,
          }).catch(() => {});
        },
      },
      {
        label: "Reveal Session in Finder",
        disabled: !session,
        onClick: () => {
          if (session) {
            revealInFinder(session.path).catch(() => {});
          }
        },
      },
      { separator: true },
      {
        label: "Close Agent",
        onClick: () => onClose(targetId),
      },
      {
        label: "Close Other Agents",
        disabled: others.length === 0,
        onClick: () => closeMany(others.map((a) => a.agent_id)),
      },
      { separator: true },
      {
        label: "Close Agents to the Left",
        disabled: toLeft.length === 0,
        onClick: () => closeMany(toLeft.map((a) => a.agent_id)),
      },
      {
        label: "Close Agents to the Right",
        disabled: toRight.length === 0,
        onClick: () => closeMany(toRight.map((a) => a.agent_id)),
      },
      { separator: true },
      {
        label: "Close Idle Agents",
        disabled: idle.length === 0,
        onClick: () => closeMany(idle.map((a) => a.agent_id)),
      },
      {
        label: "Close All Agents",
        danger: true,
        disabled: agents.length === 0,
        onClick: () => closeMany(agents.map((a) => a.agent_id)),
      },
    ];
  }, [agents, rawAgents, menuState, onClose]);

  const pairedMembers = useMemo(() => {
    const set = new Set<string>();
    if (!splitPair) {
      return set;
    }
    const hasLeft = agents.some((a) => a.agent_id === splitPair.left);
    const hasRight = agents.some((a) => a.agent_id === splitPair.right);
    if (hasLeft && hasRight) {
      set.add(splitPair.left);
      set.add(splitPair.right);
    }

    return set;
  }, [agents, splitPair]);

  const childCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of Object.values(allAgents)) {
      if (a.parent_agent_id) {
        counts[a.parent_agent_id] = (counts[a.parent_agent_id] ?? 0) + 1;
      }
    }

    return counts;
  }, [allAgents]);

  const tabsRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={tabsRef} className={styles.tabs}>
      {agents.map((agent, index) => {
        const indicator = getIndicator(agent.agent_id);
        // Number by position in the full session order, not the filtered
        // tab list, so detached agents don't renumber the remaining tabs.
        const rawIdx = rawAgents.indexOf(agent);
        const labelIndex = rawIdx >= 0 ? rawIdx : index;
        let pairedWith: (typeof agents)[number] | null | undefined = null;
        if (splitPair && pairedMembers.has(agent.agent_id)) {
          if (splitPair.left === agent.agent_id) {
            pairedWith = agents.find((a) => a.agent_id === splitPair.right);
          } else if (splitPair.right === agent.agent_id) {
            pairedWith = agents.find((a) => a.agent_id === splitPair.left);
          }
        }

        if (splitPair && pairedWith && agent.agent_id === splitPair.right) {
          // Skip the right member — the merged tab is rendered at the left
          // member's position.
          return null;
        }

        if (splitPair && pairedWith && agent.agent_id === splitPair.left) {
          const right = pairedWith;

          return (
            <MergedAgentTab
              key={`pair:${agent.agent_id}:${right.agent_id}`}
              left={agent}
              right={right}
              leftIndex={labelIndex}
              rightIndex={rawAgents.indexOf(right)}
              activeAgentId={activeAgentId}
              dropIndicator={indicator}
              onSelect={onSelect}
              onUnpair={onUnpair}
              tabRef={setTabRef(agent.agent_id)}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          );
        }

        return (
          <AgentTab
            key={agent.agent_id}
            agent={agent}
            childCount={childCounts[agent.agent_id] ?? 0}
            dropIndicator={indicator}
            hasParent={Boolean(agent.parent_agent_id)}
            index={labelIndex}
            isActive={agent.agent_id === activeAgentId}
            isSecondary={false}
            isDragging={draggingId === agent.agent_id}
            tabRef={setTabRef(agent.agent_id)}
            onClose={onClose}
            onContextMenu={handleContextMenu}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onSelect={onSelect}
          />
        );
      })}
      {menuState && (
        <ContextMenu
          items={menuItems}
          position={menuState.position}
          onClose={closeMenu}
        />
      )}
      {renameTarget && (
        <RenameAgentDialog
          agentId={renameTarget.agentId}
          currentTitle={renameTarget.currentTitle}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}
