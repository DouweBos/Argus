import type { RefType } from "@argus/peacock";

/**
 * Build a clean chip element for the browser's drag snapshot. Avoids the
 * default-drag-image behavior of capturing the whole row (which leaks the
 * row's bottom border and the surrounding chrome into the ghost).
 */
export function buildCommitDragImage(subject: string): {
  element: HTMLElement;
  x: number;
  y: number;
} {
  const el = document.createElement("div");
  el.textContent = subject.length > 60 ? `${subject.slice(0, 57)}…` : subject;
  el.style.padding = "6px 10px";
  el.style.borderRadius = "999px";
  el.style.background = "var(--accent)";
  el.style.color = "var(--accent-fg)";
  el.style.font = "var(--type-ui)";
  el.style.fontWeight = "500";
  el.style.whiteSpace = "nowrap";
  el.style.boxShadow = "var(--shadow-md)";

  return { element: el, x: 12, y: 12 };
}

/**
 * Drop intent on a commit row during a commit drag — derived from the
 * cursor's Y position relative to the row's vertical center.
 *   - `reorder-above` — cursor in the top half; insert dragged commit before this row
 *   - `reorder-below` — cursor in the bottom half; insert dragged commit after this row
 *   - `tag`           — cursor anywhere on the row while dragging a *tag* (no reorder)
 */
export type CommitDropMode = "reorder-above" | "reorder-below" | "tag";

export function commitDropModeForY(
  rect: DOMRect,
  clientY: number,
): CommitDropMode {
  const y = clientY - rect.top;

  return y < rect.height / 2 ? "reorder-above" : "reorder-below";
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const time = formatTime(iso);
    const tz = -d.getTimezoneOffset() / 60;
    const tzLabel = `GMT${tz >= 0 ? "+" : ""}${tz}`;

    return `${date} at ${time} ${tzLabel}`;
  } catch {
    return iso;
  }
}

export function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }

    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function statusLabel(status: string): string {
  return (
    {
      A: "added",
      D: "deleted",
      M: "modified",
      R: "renamed",
    }[status] ?? status
  );
}

export function classifyRef(name: string): RefType {
  const n = name.trim();
  if (n === "HEAD" || n.startsWith("HEAD ->")) {
    return "head";
  }
  if (n.startsWith("tag:")) {
    return "tag";
  }
  if (n.includes("/")) {
    return "remote-branch";
  }

  return "local-branch";
}

export function refDisplayName(name: string): string {
  return name
    .replace(/^tag:\s*/, "")
    .replace(/^HEAD ->\s*/, "")
    .trim();
}
