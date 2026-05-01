/**
 * CommitComposer — typeahead-aware commit message input.
 *
 * Triggers:
 *  \        → file paths from the current working-copy diff
 *  c:       → recent commit subjects from git log
 *  #        → GitHub issue list (optional, degrades gracefully)
 *  fixup!   → suggest from recent commits after trailing space
 *  squash!  → same as fixup!
 */

import type { DiffFile } from "../../../../lib/diffParser";
import type { GhIssue, GitCommit } from "../../../../lib/ipc";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./CommitComposer.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PopoverItem {
  icon?: string;
  label: string;
  sublabel?: string;
  value: string;
}

interface ActivePopover {
  header: string;
  items: PopoverItem[];
  onInsert: (
    item: PopoverItem,
    el: HTMLInputElement | HTMLTextAreaElement,
  ) => void;
  triggerLength: number;
  triggerStart: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCaretCoords(el: HTMLInputElement | HTMLTextAreaElement): {
  x: number;
  y: number;
} {
  const rect = el.getBoundingClientRect();

  return { x: rect.left + 8, y: rect.bottom + 4 };
}

// ---------------------------------------------------------------------------
// CommitComposer props
// ---------------------------------------------------------------------------

export interface CommitComposerProps {
  /** The commit body value. */
  body: string;
  /** Forward ref for the body textarea. */
  bodyRef?: RefObject<HTMLTextAreaElement | null>;
  /** Working-copy files (for the `\` trigger). */
  diffFiles?: DiffFile[];
  /** GitHub issues for the `#` trigger. */
  ghIssues?: GhIssue[];
  /** Called when body changes. */
  onBodyChange: (value: string) => void;
  /** Called when subject changes. */
  onSubjectChange: (value: string) => void;
  /** Called when the user presses Enter on the subject line without popover open. */
  onSubjectEnter?: () => void;
  /** Called when the subject input receives focus. */
  onSubjectFocus?: () => void;
  /** Recent commits for c: / fixup! / squash! triggers. */
  recentCommits?: GitCommit[];
  /** If true, the body textarea is rendered. */
  showBody?: boolean;
  /** The commit subject line value. */
  subject: string;
  subjectError?: boolean;
  /** Forward ref for the subject input. */
  subjectRef?: RefObject<HTMLInputElement | null>;
  /** Visual state: warn if >50, error if >72. */
  subjectWarn?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommitComposer({
  subject,
  body,
  subjectWarn,
  subjectError,
  onSubjectChange,
  onBodyChange,
  subjectRef: externalSubjectRef,
  bodyRef: externalBodyRef,
  diffFiles = [],
  recentCommits = [],
  ghIssues = [],
  showBody = false,
  onSubjectEnter,
  onSubjectFocus,
}: CommitComposerProps) {
  const internalSubjectRef = useRef<HTMLInputElement>(null);
  const internalBodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectInputRef =
    (externalSubjectRef as RefObject<HTMLInputElement>) ?? internalSubjectRef;
  const bodyTextareaRef =
    (externalBodyRef as RefObject<HTMLTextAreaElement>) ?? internalBodyRef;

  const [popover, setPopover] = useState<ActivePopover | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset active index when popover items change.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Resetting cursor position when the item list changes is intentional
       and doesn't cause cascading renders since `items.length` is stable
       within a single render cycle. */
    setActiveIndex(0);
  }, [popover?.items.length]);

  // Close popover on outside click.
  useEffect(() => {
    if (!popover) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const subjectEl = subjectInputRef.current;
      const bodyEl = bodyTextareaRef.current;
      if (
        subjectEl?.contains(target) ||
        bodyEl?.contains(target) ||
        (target as Element).closest("[data-commit-popover]") !== null
      ) {
        return;
      }
      setPopover(null);
    };
    document.addEventListener("mousedown", onDown);

    return () => document.removeEventListener("mousedown", onDown);
  }, [popover, subjectInputRef, bodyTextareaRef]);

  // Close on Escape globally.
  useEffect(() => {
    if (!popover) {
      return;
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopover(null);
      }
    };
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [popover]);

  // ---- Trigger detection ----

  const filePaths = useMemo(
    () => diffFiles.map((f) => f.newPath || f.oldPath).filter(Boolean),
    [diffFiles],
  );

  const buildCommitItems = useCallback(
    (query: string): PopoverItem[] =>
      recentCommits
        .filter(
          (c) =>
            !query || c.subject.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 12)
        .map((c) => ({
          label: c.subject,
          sublabel: c.abbreviatedHash,
          icon: undefined,
          value: c.subject,
        })),
    [recentCommits],
  );

  const buildFileItems = useCallback(
    (query: string): PopoverItem[] =>
      filePaths
        .filter((p) => !query || p.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 15)
        .map((p) => ({ label: p, value: p })),
    [filePaths],
  );

  const buildIssueItems = useCallback(
    (query: string): PopoverItem[] =>
      ghIssues
        .filter(
          (i) =>
            !query ||
            String(i.number).includes(query) ||
            i.title.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 12)
        .map((i) => ({
          label: `#${i.number} ${i.title}`,
          sublabel: `#${i.number}`,
          value: `#${i.number}`,
        })),
    [ghIssues],
  );

  // Detect trigger in text before cursor.
  const detectTrigger = useCallback(
    (
      value: string,
      cursor: number,
      _el: HTMLInputElement | HTMLTextAreaElement,
    ): ActivePopover | null => {
      const before = value.slice(0, cursor);

      // Backslash trigger: \ for file paths.
      const backslashMatch = before.match(/\\(\S*)$/);
      if (backslashMatch) {
        const query = backslashMatch[1] ?? "";
        const items = buildFileItems(query);
        if (items.length === 0 && filePaths.length === 0) {
          return null;
        }
        const triggerStart = before.lastIndexOf("\\" + query);

        return {
          items,
          header: "Files",
          triggerStart,
          triggerLength: 1 + query.length,
          onInsert: (item, input) => {
            const after = value.slice(cursor);
            const next = value.slice(0, triggerStart) + item.value + after;
            if (input instanceof HTMLInputElement) {
              onSubjectChange(next);
            } else {
              onBodyChange(next);
            }
            const newCursor = triggerStart + item.value.length;
            requestAnimationFrame(() => {
              input.setSelectionRange(newCursor, newCursor);
            });
          },
        };
      }

      // c: trigger for recent commits.
      const commitMatch = before.match(/(?:^|[\s\n])c:(\S*)$/);
      if (commitMatch) {
        const query = commitMatch[1] ?? "";
        const items = buildCommitItems(query);
        if (items.length === 0) {
          return null;
        }
        const fullTrigger = "c:" + query;
        const triggerStart = before.lastIndexOf(fullTrigger);

        return {
          items,
          header: "Recent commits",
          triggerStart,
          triggerLength: fullTrigger.length,
          onInsert: (item, input) => {
            const after = value.slice(cursor);
            const next = value.slice(0, triggerStart) + item.value + after;
            if (input instanceof HTMLInputElement) {
              onSubjectChange(next);
            } else {
              onBodyChange(next);
            }
            const newCursor = triggerStart + item.value.length;
            requestAnimationFrame(() => {
              input.setSelectionRange(newCursor, newCursor);
            });
          },
        };
      }

      // # trigger for GitHub issues.
      const issueMatch = before.match(/(?:^|[\s\n])#(\S*)$/);
      if (issueMatch && ghIssues.length > 0) {
        const query = issueMatch[1] ?? "";
        const items = buildIssueItems(query);
        if (items.length === 0) {
          return null;
        }
        const fullTrigger = "#" + query;
        const triggerStart = before.lastIndexOf(fullTrigger);

        return {
          items,
          header: "Issues",
          triggerStart,
          triggerLength: fullTrigger.length,
          onInsert: (item, input) => {
            const after = value.slice(cursor);
            const next = value.slice(0, triggerStart) + item.value + after;
            if (input instanceof HTMLInputElement) {
              onSubjectChange(next);
            } else {
              onBodyChange(next);
            }
            const newCursor = triggerStart + item.value.length;
            requestAnimationFrame(() => {
              input.setSelectionRange(newCursor, newCursor);
            });
          },
        };
      }

      // fixup! / squash! autocomplete: fire after the keyword + space.
      const fixupMatch = before.match(/^(fixup!|squash!) (\S*)$/);
      if (fixupMatch) {
        const query = fixupMatch[2] ?? "";
        const items = buildCommitItems(query);
        if (items.length === 0) {
          return null;
        }
        const prefixLen = (fixupMatch[1]?.length ?? 0) + 1; // e.g. "fixup! ".length
        const triggerStart = prefixLen;

        return {
          items,
          header: "Recent commits",
          triggerStart,
          triggerLength: query.length,
          onInsert: (item, input) => {
            const prefix = value.slice(0, prefixLen);
            const after = value.slice(cursor);
            const next = prefix + item.value + after;
            if (input instanceof HTMLInputElement) {
              onSubjectChange(next);
            } else {
              onBodyChange(next);
            }
            const newCursor = prefixLen + item.value.length;
            requestAnimationFrame(() => {
              input.setSelectionRange(newCursor, newCursor);
            });
          },
        };
      }

      return null;
    },
    [
      buildFileItems,
      buildCommitItems,
      buildIssueItems,
      filePaths.length,
      ghIssues.length,
      onSubjectChange,
      onBodyChange,
    ],
  );

  // ---- Event handlers for subject input ----

  const handleSubjectChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      onSubjectChange(value);
      const cursor = e.target.selectionStart ?? value.length;
      const trigger = detectTrigger(value, cursor, e.target);
      setPopover(trigger);
      if (trigger) {
        setPopoverPos(getCaretCoords(e.target));
      }
    },
    [onSubjectChange, detectTrigger],
  );

  const handleSubjectKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (popover) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, popover.items.length - 1));

          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));

          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const item = popover.items[activeIndex];
          if (item && subjectInputRef.current) {
            popover.onInsert(item, subjectInputRef.current);
          }
          setPopover(null);

          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setPopover(null);

          return;
        }
      }

      // No popover: let Enter bubble to parent (commit on Enter).
      if (e.key === "Enter" && !e.shiftKey && !popover) {
        onSubjectEnter?.();
      }
    },
    [popover, activeIndex, subjectInputRef, onSubjectEnter],
  );

  // ---- Event handlers for body textarea ----

  const handleBodyChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      onBodyChange(value);
      const cursor = e.target.selectionStart ?? value.length;
      const trigger = detectTrigger(value, cursor, e.target);
      setPopover(trigger);
      if (trigger) {
        setPopoverPos(getCaretCoords(e.target));
      }
    },
    [onBodyChange, detectTrigger],
  );

  const handleBodyKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!popover) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, popover.items.length - 1));

        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));

        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = popover.items[activeIndex];
        if (item && bodyTextareaRef.current) {
          popover.onInsert(item, bodyTextareaRef.current);
        }
        setPopover(null);

        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPopover(null);
      }
    },
    [popover, activeIndex, bodyTextareaRef],
  );

  // ---- Render ----

  const subjectClasses = [
    styles.subjectInput,
    subjectError ? styles.subjectError : "",
    subjectWarn && !subjectError ? styles.subjectWarn : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.root}>
      <input
        ref={subjectInputRef}
        className={subjectClasses}
        placeholder="Commit Subject"
        type="text"
        value={subject}
        onChange={handleSubjectChange}
        onFocus={onSubjectFocus}
        onKeyDown={handleSubjectKeyDown}
      />

      {showBody && (
        <textarea
          ref={bodyTextareaRef}
          className={styles.bodyTextarea}
          placeholder="Detailed description (wrap at column 72)"
          rows={3}
          value={body}
          onChange={handleBodyChange}
          onKeyDown={handleBodyKeyDown}
        />
      )}

      {/* Typeahead popover */}
      {popover &&
        popover.items.length > 0 &&
        createPortal(
          <div
            data-commit-popover
            className={styles.popover}
            style={{ left: popoverPos.x, top: popoverPos.y }}
          >
            <div className={styles.popoverHeader}>{popover.header}</div>
            {popover.items.map((item, idx) => {
              const isActive = idx === activeIndex;

              return (
                <button
                  key={item.value + idx}
                  type="button"
                  className={
                    isActive
                      ? `${styles.popoverItem} ${styles.popoverItemActive}`
                      : styles.popoverItem
                  }
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    // Prevent the textarea/input from losing focus.
                    e.preventDefault();
                  }}
                  onClick={() => {
                    const activeTarget =
                      document.activeElement === subjectInputRef.current
                        ? subjectInputRef.current
                        : (bodyTextareaRef.current ?? subjectInputRef.current);
                    if (activeTarget) {
                      popover.onInsert(item, activeTarget);
                    }
                    setPopover(null);
                  }}
                >
                  {item.icon !== undefined && (
                    <span className={styles.popoverItemIcon}>{item.icon}</span>
                  )}
                  <span className={styles.popoverItemLabel}>{item.label}</span>
                  {item.sublabel !== undefined && (
                    <span className={styles.popoverItemSub}>
                      {item.sublabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
