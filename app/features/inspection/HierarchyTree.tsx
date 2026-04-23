import type { HierarchyNode } from "./types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import styles from "./HierarchyTree.module.css";
import { findSearchMatches, matchesSearch } from "./resolveNodeVisual";
import {
  focusOnNode,
  selectNode,
  useInspectionSelection,
  useSearchQuery,
} from "./store";

interface HierarchyTreeProps {
  root: HierarchyNode;
}

export function HierarchyTree({ root }: HierarchyTreeProps) {
  const { selectedNodeId } = useInspectionSelection();
  const searchQuery = useSearchQuery();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    [root.id]: true,
  }));
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pre-compute the set of ancestor ids for every search match so their
  // rows stay visible while the user is filtering.
  const searchAncestorIds = useMemo(() => {
    if (searchQuery.trim().length === 0) {
      return null;
    }
    const matches = findSearchMatches(root, searchQuery);
    const set = new Set<string>();
    for (const match of matches) {
      const pieces = match.id.split(".");
      for (let i = 1; i <= pieces.length; i += 1) {
        set.add(pieces.slice(0, i).join("."));
      }
    }

    return set;
  }, [root, searchQuery]);

  // Strict ancestors of the selected node are force-expanded so clicking a
  // box reveals its row. The selected node itself is NOT auto-expanded —
  // arrow-navigating to a collapsed node should leave it collapsed.
  const effectiveExpanded = useMemo(() => {
    const next: Record<string, boolean> = { ...expanded };
    if (selectedNodeId) {
      const pieces = selectedNodeId.split(".");
      // < pieces.length ⇒ ancestors only, excluding the node itself.
      for (let i = 1; i < pieces.length; i += 1) {
        next[pieces.slice(0, i).join(".")] = true;
      }
    }
    if (searchAncestorIds) {
      for (const id of searchAncestorIds) {
        next[id] = true;
      }
    }

    return next;
  }, [expanded, selectedNodeId, searchAncestorIds]);

  useEffect(() => {
    if (!selectedNodeId || !containerRef.current) {
      return;
    }
    // Wait one frame so the auto-expanded ancestors are in the DOM before
    // we try to scroll to the row.
    const handle = window.requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(selectedNodeId)}"]`,
      );
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(handle);
  }, [selectedNodeId]);

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));
  };

  const expand = (id: string) => {
    setExpanded((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  };

  const collapse = useCallback((id: string) => {
    setExpanded((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
  }, []);

  // Flatten the tree in the same depth-first, expansion-respecting order the
  // tree is rendered. Powers arrow-up / arrow-down keyboard navigation.
  const visibleOrder = useMemo(() => {
    const out: HierarchyNode[] = [];
    const walk = (node: HierarchyNode) => {
      out.push(node);
      if (effectiveExpanded[node.id] && node.children.length > 0) {
        for (const child of node.children) {
          walk(child);
        }
      }
    };
    walk(root);

    return out;
  }, [root, effectiveExpanded]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selectedNodeId) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          selectNode(root.id);
        }

        return;
      }
      const idx = visibleOrder.findIndex((n) => n.id === selectedNodeId);
      if (idx < 0) {
        return;
      }
      const node = visibleOrder[idx];

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = visibleOrder[Math.min(idx + 1, visibleOrder.length - 1)];
        selectNode(next.id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = visibleOrder[Math.max(idx - 1, 0)];
        selectNode(prev.id);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (node.children.length > 0) {
          collapse(node.id);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (node.children.length > 0) {
          expand(node.id);
        }
      }
    },
    [visibleOrder, selectedNodeId, root, collapse],
  );

  return (
    <div
      ref={containerRef}
      className={styles.tree}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="tree"
    >
      <TreeNode
        node={root}
        depth={0}
        expanded={effectiveExpanded}
        onExpand={expand}
        onToggle={toggle}
        selectedNodeId={selectedNodeId}
        searchQuery={searchQuery}
      />
    </div>
  );
}

interface TreeNodeProps {
  depth: number;
  expanded: Record<string, boolean>;
  node: HierarchyNode;
  onExpand: (id: string) => void;
  onToggle: (id: string) => void;
  searchQuery: string;
  selectedNodeId: string | null;
}

function TreeNode({
  node,
  depth,
  expanded,
  onExpand,
  onToggle,
  selectedNodeId,
  searchQuery,
}: TreeNodeProps) {
  const isOpen = expanded[node.id] ?? false;
  const hasChildren = node.children.length > 0;
  const isSelected = selectedNodeId === node.id;
  const hasSearch = searchQuery.trim().length > 0;
  const isMatch = hasSearch && matchesSearch(node, searchQuery);

  const classes = [styles.row];
  if (isSelected) {
    classes.push(styles.rowSelected);
  }
  if (node.state.focused) {
    classes.push(styles.rowFocused);
  }
  if (hasSearch && !isMatch) {
    classes.push(styles.rowDimmed);
  }
  if (isMatch) {
    classes.push(styles.rowMatch);
  }

  return (
    <>
      <div
        className={classes.join(" ")}
        data-node-id={node.id}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => {
          selectNode(node.id);
          if (hasChildren) {
            onExpand(node.id);
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          focusOnNode(node.id);
        }}
      >
        {hasChildren ? (
          <span
            className={`${styles.toggle} ${isOpen ? styles.toggleOpen : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          >
            <Icons.ChevronRightIcon size={12} />
          </span>
        ) : (
          <span className={styles.togglePlaceholder} />
        )}
        <span className={styles.type}>
          {hasSearch ? (
            <HighlightedText text={node.type} query={searchQuery} />
          ) : (
            node.type
          )}
        </span>
        {node.state.focused && (
          <span
            className={styles.focusedDot}
            title="Currently focused on device"
            aria-label="Currently focused on device"
          />
        )}
        {node.label ? (
          <span className={styles.label}>
            &ldquo;
            {hasSearch ? (
              <HighlightedText text={node.label} query={searchQuery} />
            ) : (
              node.label
            )}
            &rdquo;
          </span>
        ) : null}
      </div>
      {hasChildren && isOpen
        ? node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onExpand={onExpand}
              onToggle={onToggle}
              selectedNodeId={selectedNodeId}
              searchQuery={searchQuery}
            />
          ))
        : null}
    </>
  );
}

function HighlightedText({ text, query }: { query: string; text: string }) {
  const q = query.trim();
  if (q.length === 0) {
    return <>{text}</>;
  }
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) {
    return <>{text}</>;
  }

  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.mark}>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
