import { useEffect, useRef, useState, type ReactNode } from "react";
import { error as logError } from "@logger";
import {
  splitTextForLinks,
  splitTextForMentions,
} from "../../../lib/filePathLink";
import { openFileInEditor } from "../../../lib/vscodeEditor";
import styles from "./FileLinkHandler.module.css";

interface FileLinkHandlerProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wraps children and adds ⌘-click behavior for `[data-file-path]` elements.
 * While ⌘/Ctrl is held the container gets a `cmdActive` class so CSS can
 * show pointer + underline affordances (matches VS Code's behavior).
 */
export function FileLinkHandler({ children, className }: FileLinkHandlerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [cmdHeld, setCmdHeld] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        setCmdHeld(true);
      } else {
        setCmdHeld(false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        setCmdHeld(false);
      }
    };
    // Some system shortcuts (⌘⇧4 screenshot, ⌘⇥ app switch) swallow the
    // subsequent keyup. Use mouse/pointer events — which also carry modifier
    // state — as a fallback so the affordance clears once focus returns.
    const onModifierCheck = (e: MouseEvent | PointerEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        setCmdHeld(false);
      }
    };
    const onBlur = () => setCmdHeld(false);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        setCmdHeld(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onModifierCheck);
    window.addEventListener("mousedown", onModifierCheck);
    window.addEventListener("pointermove", onModifierCheck);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onModifierCheck);
      window.removeEventListener("mousedown", onModifierCheck);
      window.removeEventListener("pointermove", onModifierCheck);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const link = target?.closest<HTMLElement>("[data-file-path]");
      if (!link) {
        return;
      }
      const path = link.dataset.filePath;
      if (!path) {
        return;
      }
      const line = link.dataset.fileLine
        ? Number(link.dataset.fileLine)
        : undefined;
      e.preventDefault();
      e.stopPropagation();
      openFileInEditor(path, line).catch((err) => {
        logError("openFileInEditor failed", err);
      });
    };

    el.addEventListener("click", onClick);

    return () => el.removeEventListener("click", onClick);
  }, []);

  const classes = [
    styles.container,
    cmdHeld ? styles.cmdActive : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={ref} className={classes}>
      {children}
    </div>
  );
}

interface LinkifiedTextProps {
  text: string;
}

/** Render plain text with file-path substrings wrapped in <a data-file-path>. */
export function LinkifiedText({ text }: LinkifiedTextProps) {
  const segments = splitTextForLinks(text);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          seg.value
        ) : (
          <a
            key={i}
            className="file-link"
            data-file-path={seg.path}
            data-file-line={seg.line}
          >
            {seg.label}
          </a>
        ),
      )}
    </>
  );
}

/**
 * Render plain text with `@mention` substrings wrapped as file-links. Used
 * for user-typed messages where mentions come from the mention picker.
 */
export function MentionedText({ text }: LinkifiedTextProps) {
  const segments = splitTextForMentions(text);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          seg.value
        ) : (
          <a
            key={i}
            className="file-link"
            data-file-path={seg.path}
            data-file-line={seg.line}
          >
            {seg.label}
          </a>
        ),
      )}
    </>
  );
}
