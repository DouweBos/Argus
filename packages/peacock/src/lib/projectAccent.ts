/**
 * Curated palette of accent colors assigned to projects. Each project gets a
 * stable color derived from a hash of its absolute path, so the same project
 * always renders with the same accent across app sessions and surfaces.
 */
export const PROJECT_ACCENT_PALETTE = [
  "#4d9fff",
  "#7c5cfc",
  "#00d4aa",
  "#f5a623",
  "#ff4466",
  "#ff7a59",
  "#22c55e",
  "#e879f9",
  "#06b6d4",
  "#facc15",
] as const;

/** FNV-1a 32-bit hash — small, fast, no deps, good enough for color buckets. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Returns a stable accent color for a project given its absolute path. Same
 * path always returns the same color across sessions.
 */
export function projectAccent(path: string): string {
  if (!path) {
    return PROJECT_ACCENT_PALETTE[0];
  }
  const idx = fnv1a(path) % PROJECT_ACCENT_PALETTE.length;
  return PROJECT_ACCENT_PALETTE[idx];
}
