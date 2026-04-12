import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateWorkspaceFolder } from "../../../lib/vscodeFilesystem";
import {
  Parts,
  attachPart,
  isPartVisibile,
  onPartVisibilityChange,
} from "../../../lib/vscodeSetup";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { SidebarHeader } from "../SidebarHeader";
import styles from "./EditorPanel.module.css";

interface EditorPanelProps {
  workspaceId: string;
}

/**
 * Hook to track visibility of a VS Code part.
 */
function usePartVisibility(part: Parts): boolean {
  const [visible, setVisible] = useState(() => {
    try {
      return isPartVisibile(part);
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const disposable = onPartVisibilityChange(part, (isVisible) => {
      setVisible(isVisible);
    });

    return () => disposable.dispose();
  }, [part]);

  return visible;
}

const SIDEBAR_DEFAULT_WIDTH = 250;
const SIDEBAR_MIN_WIDTH = 170;
const SIDEBAR_MAX_WIDTH = 500;

export function EditorPanel({ workspaceId }: EditorPanelProps) {
  const activityBarRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const statusBarRef = useRef<HTMLDivElement>(null);
  const auxiliaryBarRef = useRef<HTMLDivElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const isDragging = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.classList.add("sim-touching");
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !panelContainerRef.current) {
        return;
      }
      const rect = panelContainerRef.current.getBoundingClientRect();
      const newWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, e.clientX - rect.left),
      );
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      if (!isDragging.current) {
        return;
      }
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.classList.remove("sim-touching");
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const workspaces = useWorkspaces();
  const workspacePath = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.path ?? null,
    [workspaces, workspaceId],
  );

  // Point VS Code at the worktree directory when workspace changes
  useEffect(() => {
    if (workspacePath) {
      updateWorkspaceFolder(workspacePath);
    }
  }, [workspacePath]);

  // Mount VS Code parts into our DOM containers (once)
  useEffect(() => {
    if (mountedRef.current) {
      return;
    }
    mountedRef.current = true;

    const containers: {
      part: Parts;
      ref: React.RefObject<HTMLDivElement | null>;
    }[] = [
      { ref: activityBarRef, part: Parts.ACTIVITYBAR_PART },
      { ref: sidebarRef, part: Parts.SIDEBAR_PART },
      { ref: editorRef, part: Parts.EDITOR_PART },
      { ref: panelRef, part: Parts.PANEL_PART },
      { ref: statusBarRef, part: Parts.STATUSBAR_PART },
      { ref: auxiliaryBarRef, part: Parts.AUXILIARYBAR_PART },
    ];

    for (const { ref, part } of containers) {
      if (ref.current) {
        attachPart(part, ref.current);
      }
    }
  }, []);

  // Track part visibility for layout
  const sidebarVisible = usePartVisibility(Parts.SIDEBAR_PART);
  const auxiliaryBarVisible = usePartVisibility(Parts.AUXILIARYBAR_PART);

  // Panel starts hidden — only becomes visible when user explicitly
  // toggles it (e.g. via ⌘J). This avoids the race with extensions
  // that re-open the panel after init.
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    const disposable = onPartVisibilityChange(
      Parts.PANEL_PART,
      setPanelVisible,
    );

    return () => disposable.dispose();
  }, []);

  return (
    <div ref={panelContainerRef} className={styles.panel}>
      <div ref={activityBarRef} className={styles.activityBar} />
      <div
        className={styles.sidebarContainer}
        style={{
          width: sidebarWidth,
          display: sidebarVisible ? undefined : "none",
        }}
      >
        <SidebarHeader />
        <div ref={sidebarRef} className={styles.sidebar} />
        <div className={styles.resizeHandle} onMouseDown={onResizeStart} />
      </div>
      <div className={styles.main}>
        <div ref={editorRef} className={styles.editor} />
        <div
          ref={panelRef}
          className={styles.bottomPanel}
          style={{ display: panelVisible ? undefined : "none" }}
        />
      </div>
      <div
        ref={auxiliaryBarRef}
        className={styles.auxiliaryBar}
        style={{ display: auxiliaryBarVisible ? undefined : "none" }}
      />
      <div ref={statusBarRef} className={styles.statusBar} />
    </div>
  );
}
