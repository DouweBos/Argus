import { useCallback, useEffect, useRef, useState } from "react";
import { Icons } from "@argus/peacock";
import {
  completeAreaCapture,
  launcherHide,
  launcherReady,
} from "../../lib/ipc";
import { ImageViewer } from "../shared/ImageViewer/ImageViewer";
import { GlobalSessionLauncher } from "./GlobalSessionLauncher";
import styles from "./LauncherPopout.module.css";

interface DragState {
  current: { x: number; y: number };
  start: { x: number; y: number };
}

interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

function normalizeRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Renderer for `?popout=launcher`. The BrowserWindow covers the entire
 * cursor's display; here we paint:
 *
 *   - a full-bleed dim backdrop (20% black) that doubles as the area-capture
 *     surface — drags initiated outside the card marquee a rectangle that
 *     gets cropped from the screen and attached to the prompt.
 *   - a floating card containing the launcher form, with brand + close on
 *     top.
 *
 * The `displayId` URL param is forwarded back to main on capture completion
 * so the right display's source is cropped.
 */
export function LauncherPopout() {
  const params = new URLSearchParams(window.location.search);
  const displayId = params.get("displayId") ?? "";

  const backdropRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // ---- Body class & transparent backgrounds ----
  useEffect(() => {
    document.body.classList.add("argus-popout", "argus-launcher");
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    return () => {
      document.body.classList.remove("argus-popout", "argus-launcher");
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, []);

  // ---- Tell main process the renderer has actually painted ----
  // Wait for two animation frames so the styled backdrop + card are fully on
  // the GPU before we ask main to unhide; that avoids the brief flash of the
  // unstyled opaque WebContents background on first show.
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        launcherReady().catch(() => undefined);
      });
    });

    return () => cancelAnimationFrame(raf1);
  }, []);

  // ---- Esc to dismiss ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        launcherHide().catch(() => undefined);
      }
    }
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ---- Drag-to-capture on the backdrop ----
  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    // Only when the user clicked the backdrop itself, not bubbled from the
    // card or any popover content sitting above it.
    if (e.target !== backdropRef.current) {
      return;
    }
    if (e.button !== 0) {
      return;
    }
    setDrag({
      start: { x: e.clientX, y: e.clientY },
      current: { x: e.clientX, y: e.clientY },
    });
  }, []);

  // Document-level move/up so the marquee keeps tracking when the cursor
  // crosses the card.
  useEffect(() => {
    if (!drag) {
      return;
    }
    const move = (e: MouseEvent) => {
      setDrag((d) =>
        d ? { ...d, current: { x: e.clientX, y: e.clientY } } : null,
      );
    };
    const up = (e: MouseEvent) => {
      const finalRect = normalizeRect(drag.start, {
        x: e.clientX,
        y: e.clientY,
      });
      setDrag(null);
      if (finalRect.width >= 3 && finalRect.height >= 3 && displayId) {
        completeAreaCapture(finalRect, displayId).catch(() => undefined);
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);

    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [drag, displayId]);

  const rect = drag ? normalizeRect(drag.start, drag.current) : null;

  return (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      onMouseDown={handleBackdropMouseDown}
    >
      {rect && (
        <div
          className={styles.selection}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}

      {!rect && (
        <div className={styles.captureHint}>
          Drag to attach a region · Esc to dismiss
        </div>
      )}
      {rect && rect.width > 0 && rect.height > 0 && (
        <div
          className={styles.captureHint}
          style={{ left: rect.x, top: rect.y - 24 }}
        >
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </div>
      )}

      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.brand}>
            <Icons.ArgusLogo size={16} />
            <span className={styles.brandText}>Argus</span>
          </span>
          <button
            aria-label="Close launcher"
            className={styles.closeBtn}
            type="button"
            onClick={() => {
              launcherHide().catch(() => undefined);
            }}
          >
            <Icons.CloseIcon size={11} />
          </button>
        </header>
        <GlobalSessionLauncher />
      </div>
      <ImageViewer />
    </div>
  );
}
