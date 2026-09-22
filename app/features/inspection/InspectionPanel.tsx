import type { HierarchyNode } from "./types";
import { useEffect, useMemo } from "react";
import { Banner, Button, Icons, Spinner } from "@argus/peacock";
import { useDragResize } from "@argus/peacock";
import { HierarchySearch } from "./HierarchySearch";
import { HierarchyTree } from "./HierarchyTree";
import { InspectionLauncher } from "./InspectionLauncher";
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
  useActiveCapture,
  useCaptureList,
  useCaptureStatus,
  useFocusedRootNodeId,
  useLaunchPrompt,
  useRendererMode,
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

function inspectButtonLabel(capturing: boolean, hasCapture: boolean): string {
  if (capturing) {
    return hasCapture ? "Refreshing…" : "Inspecting…";
  }

  return hasCapture ? "Refresh" : "Inspect";
}

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
  const { launchPrompt, installedApps, launching } = useLaunchPrompt();
  const mode = useRendererMode();
  const focusedRootId = useFocusedRootNodeId();

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

  // Re-inspecting an already-captured screen reads as "Refresh".
  const inspectLabel = inspectButtonLabel(capturing, !!activeCapture);

  useEffect(() => {
    clearCaptures();
  }, [deviceKey]);

  const onInspect = () => {
    runCapture(deviceKey).catch(() => {
      // Errors land in the store's captureError; nothing to do here.
    });
  };

  const { size: sidebarWidth, onPointerDown: onSidebarResize } = useDragResize({
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

  function renderMain() {
    if (activeCapture && treeRoot) {
      return (
        <InspectionRenderer
          capture={activeCapture}
          root={treeRoot}
          mode={mode}
        />
      );
    }
    if (launchPrompt) {
      return (
        <InspectionLauncher
          deviceKey={deviceKey}
          foregroundApp={launchPrompt.foregroundApp}
          isSpringboard={launchPrompt.isSpringboard}
          installedApps={installedApps}
          launching={launching}
        />
      );
    }

    return <EmptyState hasDevice={!!deviceKey} capturing={capturing} />;
  }

  return (
    <div className={styles.root}>
      <Banner
        tone="info"
        leading={<Icons.SearchIcon size={11} />}
        className={styles.sdkBanner}
      >
        Inspect reads the running app in-process — real classes, colors, fonts,
        and the full view/layer tree. Requires launching the app with injection
        (<code>launch-app --inject</code>).
      </Banner>
      <div className={styles.header}>
        {!showSidebar && (
          <Button
            size="sm"
            variant="primary"
            disabled={capturing || !deviceKey}
            onClick={onInspect}
          >
            {inspectLabel}
          </Button>
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
            <span>{activeCapture.nodeCount} nodes</span>
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
              <span className={styles.sidebarTitle}>Hierarchy</span>
              {treeRoot && (
                <span className={styles.sidebarCount}>{nodeCount}</span>
              )}
              <div className={styles.sidebarSpacer} />
              <Button
                size="sm"
                variant="primary"
                disabled={capturing || !deviceKey}
                onClick={onInspect}
              >
                {inspectLabel}
              </Button>
            </div>
            {renderSidebarBody({ activeCapture, capturing, treeRoot })}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize hierarchy"
              className={styles.sidebarResizer}
              onPointerDown={onSidebarResize}
            />
          </div>
        )}
        <div className={styles.main}>{renderMain()}</div>
      </div>
    </div>
  );
}

interface Node {
  class: string;
  id: string;
  text?: string;
}

function renderSidebarBody({
  activeCapture,
  capturing,
  treeRoot,
}: {
  activeCapture: ReturnType<typeof useActiveCapture>;
  capturing: boolean;
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
              {node.class}
              {node.text ? (
                <span className={styles.breadcrumbLabel}>
                  &nbsp;&ldquo;{node.text}&rdquo;
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
          Reading the live view/layer tree — classes, colors, fonts, and text —
          from inside the running app. This usually takes a couple of seconds.
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
          ? "Press Inspect to read the running app's native view/layer tree with real classes, colors, fonts, and text. The app must have been launched with injection (launch-app --inject)."
          : "Boot an iOS/tvOS simulator from the Simulate tab above, then return here and press Inspect."}
      </div>
    </div>
  );
}
