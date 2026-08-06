import type { Capture, HierarchyNode } from "./types";
import type { ContextMenuItem } from "@argus/peacock";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ContextMenu } from "@argus/peacock";
import styles from "./FlatRenderer.module.css";
import {
  flattenHierarchy,
  fmtCoord,
  isVisibleLeaf,
  nodeHint,
  nodeRect,
  nodesContainingPoint,
  resolveNodeVisual,
} from "./resolveNodeVisual";
import { focusOnNode, selectNode, useInspectionSelection } from "./store";

interface FlatRendererProps {
  capture: Capture;
  /** Subtree to draw + hit-test; defaults to the whole capture. When a node is
   * focused (double-click), this narrows selection to that subtree's descendants
   * so clicks in the canvas can't grab filtered-out siblings. */
  root?: HierarchyNode;
}

function useContainSize(
  containerRef: React.RefObject<HTMLDivElement | null>,
  deviceW: number,
  deviceH: number,
) {
  const [size, setSize] = useState<{ h: number; w: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) {
        return;
      }
      const scale = Math.min(width / deviceW, height / deviceH);
      setSize({
        w: Math.round(deviceW * scale),
        h: Math.round(deviceH * scale),
      });
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, [containerRef, deviceW, deviceH]);

  return size;
}

interface StackMenu {
  nodes: HierarchyNode[];
  x: number;
  y: number;
}

export function FlatRenderer({ capture, root }: FlatRendererProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodeId } = useInspectionSelection();
  const [stackMenu, setStackMenu] = useState<StackMenu | null>(null);

  const rootNode = root ?? capture.hierarchy;
  const nodes = useMemo(() => flattenHierarchy(rootNode), [rootNode]);

  const deviceW = capture.device.width;
  const deviceH = capture.device.height;
  const { w: stageW, h: stageH } = useContainSize(rootRef, deviceW, deviceH);

  const scaleX = deviceW > 0 ? stageW / deviceW : 0;
  const scaleY = deviceH > 0 ? stageH / deviceH : 0;

  const screenshotSrc = capture.screenshot
    ? `data:image/${capture.screenshot.encoding};base64,${capture.screenshot.data}`
    : null;

  const hitTest = useCallback(
    (clientX: number, clientY: number): HierarchyNode[] => {
      const el = inputRef.current;
      if (!el || scaleX === 0 || scaleY === 0) {
        return [];
      }
      const rect = el.getBoundingClientRect();
      const devX = (clientX - rect.left) / scaleX;
      const devY = (clientY - rect.top) / scaleY;

      return nodesContainingPoint(rootNode, devX, devY);
    },
    [rootNode, scaleX, scaleY],
  );

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const hits = hitTest(e.clientX, e.clientY);
    if (hits.length === 0) {
      return;
    }
    selectNode(hits[hits.length - 1].id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const hits = hitTest(e.clientX, e.clientY);
    if (hits.length === 0) {
      return;
    }
    e.preventDefault();
    focusOnNode(hits[hits.length - 1].id);
  };

  // Native contextmenu beats React's synthetic in Electron, so we attach a
  // raw capture-phase listener for right-clicks.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const hits = hitTest(e.clientX, e.clientY);
      if (hits.length === 0) {
        return;
      }
      setStackMenu({ nodes: hits, x: e.clientX, y: e.clientY });
    };
    el.addEventListener("contextmenu", handler, true);

    return () => el.removeEventListener("contextmenu", handler, true);
  }, [hitTest]);

  const stackItems = useMemo<ContextMenuItem[]>(() => {
    if (!stackMenu) {
      return [];
    }

    return [
      { header: `${stackMenu.nodes.length} elements under cursor` },
      ...stackMenu.nodes
        .slice()
        .reverse()
        .map((n): ContextMenuItem => {
          const hint = nodeHint(n);
          const fullHint = nodeHint(n, Infinity);
          const rect = nodeRect(n);

          return {
            label: hint ? `${n.class}  ${hint}` : n.class,
            title: fullHint ? `${n.class}  ${fullHint}` : n.class,
            trailing: `${fmtCoord(rect.w)}×${fmtCoord(rect.h)}`,
            selected: selectedNodeId === n.id,
            onClick: () => selectNode(n.id),
          };
        }),
    ];
  }, [stackMenu, selectedNodeId]);

  return (
    <div ref={rootRef} className={styles.root}>
      {stageW > 0 && stageH > 0 && (
        <div className={styles.stage} style={{ width: stageW, height: stageH }}>
          {screenshotSrc && (
            <img
              className={styles.screenshot}
              src={screenshotSrc}
              alt="Captured screen"
              draggable={false}
            />
          )}
          <div className={styles.overlay}>
            {nodes.map((node) => (
              <NodeBox
                key={node.id}
                node={node}
                scaleX={scaleX}
                scaleY={scaleY}
                selected={selectedNodeId === node.id}
                tint={!screenshotSrc}
              />
            ))}
          </div>
          {/* Single interaction layer on top — the boxes below are visual
              only. React synthetic handlers for click / dblclick; a native
              capture-phase listener handles contextmenu because Electron
              beats React's contextmenu synthetic. */}
          <div
            ref={inputRef}
            className={styles.inputLayer}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
          />
        </div>
      )}
      {stackMenu && (
        <ContextMenu
          items={stackItems}
          position={{ x: stackMenu.x, y: stackMenu.y }}
          onClose={() => setStackMenu(null)}
        />
      )}
    </div>
  );
}

interface NodeBoxProps {
  node: HierarchyNode;
  scaleX: number;
  scaleY: number;
  selected: boolean;
  /** Fill the box with its real background color (bare-box, no-screenshot mode). */
  tint: boolean;
}

function NodeBox({ node, scaleX, scaleY, selected, tint }: NodeBoxProps) {
  const visual = resolveNodeVisual(node);
  const leaf = isVisibleLeaf(node);
  const rect = nodeRect(node);

  const classes = [styles.box, leaf ? styles.boxLeaf : styles.boxContainer];
  if (selected) {
    classes.push(styles.boxSelected);
  }

  return (
    <div
      className={classes.join(" ")}
      style={{
        left: rect.x * scaleX,
        top: rect.y * scaleY,
        width: rect.w * scaleX,
        height: rect.h * scaleY,
        // Captured device color (runtime data, not a token) tints the box so
        // the overlay reads even without a screenshot behind it.
        ...(tint && visual.kind === "fill"
          ? { backgroundColor: visual.color }
          : null),
      }}
      title={node.text ?? node.accessibilityLabel ?? node.class}
    />
  );
}
