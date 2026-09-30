export interface SetupProgress {
  current: number;
  /** Latest line the running command printed. */
  detail?: string;
  item: string;
  phase?: "command" | "copy" | "matching" | "symlink";
  total: number;
}

export interface DeleteProgress {
  current: number;
  total: number;
}

/**
 * Fill ratio for a setup bar, or null while the step count is unknown.
 * `current` is the step now running, so it hasn't been earned yet — counting
 * it shows a full bar for the whole of a final, slow command.
 */
export function setupFraction(progress: SetupProgress | undefined) {
  if (!progress || progress.total <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, (progress.current - 1) / progress.total));
}

/** Fill ratio for a removal bar, or null before the first count arrives. */
export function deleteFraction(progress: DeleteProgress | undefined) {
  if (!progress || progress.total <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, progress.current / progress.total));
}

export function deleteProgressLabel(progress: DeleteProgress | undefined) {
  if (!progress || progress.total <= 0) {
    return "Removing files…";
  }

  return `${progress.current.toLocaleString()} of ${progress.total.toLocaleString()} items removed`;
}

/** Keep the end of a long path, which is the part that tells items apart. */
export function truncateStart(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }

  return `…${str.slice(-(maxLen - 1))}`;
}
