import type { SidebarTab } from "./store";
import type { HierarchyNode } from "./types";
import { useEffect, useMemo } from "react";
import {
  Banner,
  Button,
  Icons,
  SegmentedControl,
  Spinner,
  StatusDot,
} from "@argus/peacock";
import { useDragResize } from "../../hooks/useDragResize";
import { AccessibilityList } from "./AccessibilityList";
import { HierarchySearch } from "./HierarchySearch";
import { HierarchyTree } from "./HierarchyTree";
import styles from "./InspectionPanel.module.css";
import { InspectionRenderer } from "./InspectionRenderer";
import {
  findNodeById,
  flattenHierarchy,
  pathToNode,
} from "./resolveNodeVisual";
import {
  capture as runCapture,
  clearCaptures,
  focusOnNode,
  selectCapture,
  selectNode,
  setSidebarTab,
  useActiveCapture,
  useCaptureList,
  useCaptureStatus,
  useFocusedNode,
  useFocusedRootNodeId,
  useRendererMode,
  useSidebarTab,
} from "./store";

interface InspectionPanelProps {
  /** Active device key (UDID / emulator serial). */
  deviceKey: string | null;
  /** Show the tree sidebar — only useful once the runtime has real width. */
  showSidebar?: boolean;
}

const SIDEBAR_WIDTH_KEY = "argus:inspection:sidebarWidth";
const SIDEBAR_DEFAULT = 280;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 560;

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
    }
  } catch {
    // ignore
  }

  return SIDEBAR_DEFAULT;
}

export function InspectionPanel({
  deviceKey,
  showSidebar = true,
}: InspectionPanelProps) {
  const activeCapture = useActiveCapture();
  const { captureOrder, activeCaptureId, captures } = useCaptureList();
  const { capturing, captureError } = useCaptureStatus();
  const sidebarTab = useSidebarTab();
  const mode = useRendererMode();
  const focusedRootId = useFocusedRootNodeId();
  const focusedNode = useFocusedNode();

  const { treeRoot, breadcrumbs } = useMemo(() => {
    if (!activeCapture) {
      return { treeRoot: null, breadcrumbs: [] };
    }
    if (!focusedRootId) {
      return { treeRoot: activeCapture.hierarchy, breadcrumbs: [] };
    }
    const focused = findNodeById(activeCapture.hierarchy, focusedRootId);
    if (!focused) {
      return { treeRoot: activeCapture.hierarchy, breadcrumbs: [] };
    }

    return {
      treeRoot: focused,
      breadcrumbs: pathToNode(activeCapture.hierarchy, focusedRootId),
    };
  }, [activeCapture, focusedRootId]);

  const nodeCount = useMemo(
    () => (treeRoot ? flattenHierarchy(treeRoot).length : 0),
    [treeRoot],
  );

  useEffect(() => {
    clearCaptures();
  }, [deviceKey]);

  const onInspect = () => {
    runCapture(deviceKey).catch(() => {
      // Errors land in the store's captureError; nothing to do here.
    });
  };

  const { size: sidebarWidth, onMouseDown: onSidebarResize } = useDragResize({
    axis: "horizontal",
    initialSize: loadSidebarWidth(),
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // ignore storage failures
    }
  }, [sidebarWidth]);

  return (
    <div className={styles.root}>
      <Banner
        tone="info"
        leading={<Icons.SearchIcon size={11} />}
        className={styles.sdkBanner}
      >
        Inspect runs against the accessibility hierarchy — class names and
        better view hierarchy inspection tools will come soon through an custom SDK.
      </Banner>
      <div className={styles.header}>
        {!showSidebar && (
          <Button
            size="sm"
            variant="primary"
            disabled={capturing || !deviceKey}
            onClick={onInspect}
          >
            {capturing ? "Inspecting…" : "Inspect"}
          </Button>
        )}
        {focusedNode && (
          <button
            type="button"
            className={styles.focusedPill}
            onClick={() => selectNode(focusedNode.id)}
            title={`Jump to focused element: ${focusedNode.type}${focusedNode.label ? ` "${focusedNode.label}"` : ""}`}
          >
            <StatusDot tone="warning" pulse />
            <span className={styles.focusedPillLabel}>Focused</span>
            <span className={styles.focusedPillType}>{focusedNode.type}</span>
          </button>
        )}
        {captureOrder.length > 1 && (
          <select
            className={styles.select}
            value={activeCaptureId ?? ""}
            onChange={(e) => selectCapture(e.target.value || null)}
          >
            {captureOrder.map((id, i) => (
              <option key={id} value={id}>
                Snapshot {i + 1} · {captures[id]?.capturedAt.slice(11, 19)}
              </option>
            ))}
          </select>
        )}
        <div className={styles.spacer} />
        {activeCapture && (
          <div className={styles.meta}>
            <span>{activeCapture.device.platform.toUpperCase()}</span>
            <span className={styles.metaSeparator}>·</span>
            <span>
              {activeCapture.device.width} × {activeCapture.device.height}
            </span>
            <span className={styles.metaSeparator}>·</span>
            <span>{activeCapture.a11ySnapshot.length} a11y</span>
          </div>
        )}
      </div>
      {breadcrumbs.length > 0 && (
        <Breadcrumbs trail={breadcrumbs} focusedId={focusedRootId} />
      )}
      {captureError && (
        <div className={styles.error}>
          <span className={styles.errorDot} />
          <span>{captureError}</span>
        </div>
      )}
      <div className={styles.body}>
        {showSidebar && (
          <div className={styles.sidebar} style={{ width: sidebarWidth }}>
            <div className={styles.sidebarTabs}>
              <SegmentedControl<SidebarTab>
                aria-label="Sidebar view"
                size="sm"
                value={sidebarTab}
                onChange={setSidebarTab}
                options={[
                  { value: "hierarchy", label: "Hierarchy" },
                  { value: "a11y", label: "Accessibility" },
                ]}
              />
              {treeRoot && (
                <span className={styles.sidebarCount}>
                  {sidebarTab === "hierarchy"
                    ? nodeCount
                    : (activeCapture?.a11ySnapshot.length ?? 0)}
                </span>
              )}
              <div className={styles.sidebarSpacer} />
              <Button
                size="sm"
                variant="primary"
                disabled={capturing || !deviceKey}
                onClick={onInspect}
              >
                {capturing ? "Inspecting…" : "Inspect"}
              </Button>
            </div>
            {renderSidebarBody({
              activeCapture,
              capturing,
              sidebarTab,
              treeRoot,
            })}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize hierarchy"
              className={styles.sidebarResizer}
              onMouseDown={onSidebarResize}
            />
          </div>
        )}
        <div className={styles.main}>
          {activeCapture && treeRoot ? (
            <InspectionRenderer capture={activeCapture} mode={mode} />
          ) : (
            <EmptyState hasDevice={!!deviceKey} capturing={capturing} />
          )}
        </div>
      </div>
    </div>
  );
}

interface Node {
  id: string;
  label?: string;
  type: string;
}

function renderSidebarBody({
  activeCapture,
  capturing,
  sidebarTab,
  treeRoot,
}: {
  activeCapture: ReturnType<typeof useActiveCapture>;
  capturing: boolean;
  sidebarTab: SidebarTab;
  treeRoot: HierarchyNode | null;
}) {
  if (!treeRoot || !activeCapture) {
    return (
      <div className={styles.sidebarPlaceholder}>
        {capturing
          ? "Building hierarchy…"
          : "Hierarchy appears here after inspecting."}
      </div>
    );
  }
  if (sidebarTab === "a11y") {
    return <AccessibilityList entries={activeCapture.a11ySnapshot} />;
  }

  return (
    <>
      <HierarchySearch root={treeRoot} />
      <HierarchyTree root={treeRoot} />
    </>
  );
}

function Breadcrumbs({
  trail,
  focusedId,
}: {
  focusedId: string | null;
  trail: Node[];
}) {
  return (
    <div className={styles.breadcrumbs}>
      <button
        type="button"
        className={styles.breadcrumbReset}
        onClick={() => focusOnNode(null)}
        title="Exit focused view"
      >
        <Icons.CloseIcon size={10} />
        <span>Full tree</span>
      </button>
      <span className={styles.breadcrumbSeparator}>›</span>
      {trail.map((node, i) => {
        const isLast = i === trail.length - 1;
        const isFocused = node.id === focusedId;

        return (
          <span key={node.id} className={styles.breadcrumbGroup}>
            <button
              type="button"
              className={`${styles.breadcrumb} ${isFocused ? styles.breadcrumbActive : ""}`}
              onClick={() => {
                if (isFocused) {
                  selectNode(node.id);
                } else {
                  focusOnNode(node.id);
                }
              }}
            >
              {node.type}
              {node.label ? (
                <span className={styles.breadcrumbLabel}>
                  &nbsp;&ldquo;{node.label}&rdquo;
                </span>
              ) : null}
            </button>
            {!isLast && <span className={styles.breadcrumbSeparator}>›</span>}
          </span>
        );
      })}
    </div>
  );
}

function EmptyState({
  hasDevice,
  capturing,
}: {
  capturing: boolean;
  hasDevice: boolean;
}) {
  if (capturing) {
    return (
      <div className={styles.empty}>
        <Spinner size="lg" aria-label="Fetching UI" />
        <div className={styles.emptyTitle}>Fetching UI…</div>
        <div className={styles.emptyHint}>
          Pulling the screenshot, view hierarchy, and accessibility snapshot
          from the device. This usually takes a couple of seconds.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.empty}>
      <Icons.SearchIcon size={32} />
      <div className={styles.emptyTitle}>Inspect a live screen</div>
      <div className={styles.emptyHint}>
        {hasDevice
          ? "Press Inspect to snapshot the current UI. You'll get the screenshot, the view hierarchy, and the accessibility order in one bundle."
          : "Boot a simulator from the Simulate tab above, then return here and press Inspect."}
      </div>
    </div>
  );
}
