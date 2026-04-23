import type { Capture, HierarchyNode } from "./types";
import type { ContextMenuItem } from "@argus/peacock";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContextMenu } from "@argus/peacock";
import { A11yBadgeLayer } from "./A11yBadgeLayer";
import styles from "./FlatRenderer.module.css";
import {
  flattenHierarchy,
  fmtCoord,
  isVisibleLeaf,
  nodesContainingPoint,
  resolveNodeVisual,
} from "./resolveNodeVisual";
import {
  focusOnNode,
  selectNode,
  useA11yOverlayState,
  useInspectionSelection,
} from "./store";

interface FlatRendererProps {
  capture: Capture;
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

export function FlatRenderer({ capture }: FlatRendererProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);
  const { selectedNodeId } = useInspectionSelection();
  const { showBadges } = useA11yOverlayState();
  const [stackMenu, setStackMenu] = useState<StackMenu | null>(null);

  const nodes = useMemo(
    () => flattenHierarchy(capture.hierarchy),
    [capture.hierarchy],
  );

  const deviceW = capture.device.width;
  const deviceH = capture.device.height;
  const { w: stageW, h: stageH } = useContainSize(rootRef, deviceW, deviceH);

  const scaleX = deviceW > 0 ? stageW / deviceW : 0;
  const scaleY = deviceH > 0 ? stageH / deviceH : 0;

  const screenshotSrc = `data:image/${capture.screenshot.encoding};base64,${capture.screenshot.data}`;

  const hitTest = (clientX: number, clientY: number): HierarchyNode[] => {
    const el = inputRef.current;
    if (!el || scaleX === 0 || scaleY === 0) {
      return [];
    }
    const rect = el.getBoundingClientRect();
    const devX = (clientX - rect.left) / scaleX;
    const devY = (clientY - rect.top) / scaleY;

    return nodesContainingPoint(capture.hierarchy, devX, devY);
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hitTest closes
    // over current scale/capture on every render; the listener always sees
    // the latest via the closure created on this effect invocation.
  }, [capture, scaleX, scaleY]);

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
          const labelSuffix = n.label ? `  "${truncate(n.label, 32)}"` : "";

          return {
            label: `${n.type}${labelSuffix}`,
            trailing: `${fmtCoord(n.frame.w)}×${fmtCoord(n.frame.h)}`,
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
          <img
            className={styles.screenshot}
            src={screenshotSrc}
            alt="Captured screen"
            draggable={false}
          />
          <div className={styles.overlay}>
            {nodes.map((node) => (
              <NodeBox
                key={node.id}
                capture={capture}
                node={node}
                scaleX={scaleX}
                scaleY={scaleY}
                selected={selectedNodeId === node.id}
              />
            ))}
          </div>
          {showBadges && (
            <A11yBadgeLayer capture={capture} scaleX={scaleX} scaleY={scaleY} />
          )}
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
  capture: Capture;
  node: HierarchyNode;
  scaleX: number;
  scaleY: number;
  selected: boolean;
}

function NodeBox({ capture, node, scaleX, scaleY, selected }: NodeBoxProps) {
  const visual = resolveNodeVisual(node, capture);
  const leaf = visual.kind !== "outline" && isVisibleLeaf(node);

  const classes = [styles.box, leaf ? styles.boxLeaf : styles.boxContainer];
  if (node.state.focused) {
    classes.push(styles.boxFocused);
  }
  if (selected) {
    classes.push(styles.boxSelected);
  }

  return (
    <div
      className={classes.join(" ")}
      style={{
        left: node.frame.x * scaleX,
        top: node.frame.y * scaleY,
        width: node.frame.w * scaleX,
        height: node.frame.h * scaleY,
      }}
      title={node.label ?? node.identifier ?? node.type}
    />
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
