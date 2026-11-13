import type { WorktreeCleanupSweep } from "@argus/remote-protocol";

const GB = 1024 ** 3;

export function formatBytes(bytes: number): string {
  if (bytes >= GB) {
    return `${(bytes / GB).toFixed(1)} GB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** The line Notifications shows for a sweep. */
export function cleanupMessage(sweep: WorktreeCleanupSweep): string {
  const n = sweep.removed.length;
  const names = sweep.removed.map((e) => e.display_name || e.branch);
  const shown =
    names.length > 5
      ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more`
      : names.join(", ");
  const parts: string[] = [];
  if (n > 0) {
    parts.push(
      `Cleaned up ${n} worktree${n === 1 ? "" : "s"} and freed ${formatBytes(sweep.freed_bytes)}: ${shown}.`,
    );
  }
  if (sweep.failed > 0) {
    parts.push(`${sweep.failed} couldn't be removed.`);
  }

  return parts.join(" ");
}

export function bucketCount(n: number): "0" | "1" | "2-5" | "6+" {
  if (n === 0) {
    return "0";
  }
  if (n === 1) {
    return "1";
  }

  return n <= 5 ? "2-5" : "6+";
}

export function bucketBytes(
  bytes: number,
): "<1gb" | "0" | "1-10gb" | "10-100gb" | "100gb+" {
  if (bytes === 0) {
    return "0";
  }
  if (bytes < GB) {
    return "<1gb";
  }
  if (bytes < 10 * GB) {
    return "1-10gb";
  }

  return bytes < 100 * GB ? "10-100gb" : "100gb+";
}
