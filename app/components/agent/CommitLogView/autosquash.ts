import type { GitCommit } from "../../../lib/ipc";

const FIXUP_RE = /^(?:fixup|squash|amend)!\s+(.*)$/;

function stripPrefixes(subject: string): string {
  let out = subject;
  while (true) {
    const m = out.match(FIXUP_RE);
    if (!m) {
      return out;
    }
    out = m[1];
  }
}

export interface AutosquashDetection {
  count: number;
  /** Commit whose parent should be the rebase upstream (the oldest target). */
  oldestTarget: GitCommit;
}

/**
 * Scan the visible commit list for `fixup!` / `squash!` commits whose target
 * is also visible and on HEAD. Returns null if there's nothing to autosquash.
 *
 * `commits` is newest-first (the order returned by `git log`). The "oldest"
 * target is therefore the one with the largest index.
 */
export function detectAutosquash(
  commits: GitCommit[],
  headHashes: Set<string>,
): AutosquashDetection | null {
  // Map each non-fixup subject to its oldest occurrence on HEAD. Iterating
  // newest-first and overwriting means the final entry is the oldest commit
  // with that subject.
  const subjectToTarget = new Map<string, GitCommit>();
  for (const c of commits) {
    if (!headHashes.has(c.hash)) {
      continue;
    }
    if (FIXUP_RE.test(c.subject)) {
      continue;
    }
    subjectToTarget.set(c.subject, c);
  }

  let count = 0;
  let oldestTarget: GitCommit | null = null;
  let oldestIdx = -1;

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    if (!headHashes.has(c.hash)) {
      continue;
    }
    const m = c.subject.match(FIXUP_RE);
    if (!m) {
      continue;
    }
    const targetSubject = stripPrefixes(m[1]);
    const target = subjectToTarget.get(targetSubject);
    if (!target) {
      continue;
    }
    count++;
    const idx = commits.indexOf(target);
    if (idx > oldestIdx) {
      oldestIdx = idx;
      oldestTarget = target;
    }
  }

  if (count === 0 || !oldestTarget) {
    return null;
  }

  return { count, oldestTarget };
}
