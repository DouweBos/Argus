/**
 * fzf-style fuzzy scoring of one name against a query, the scoring of the
 * Swift `FuzzyFileMatcher` without the path part: the query is a
 * case-insensitive subsequence; word boundaries (`_`, `-`, `.`, camelCase),
 * runs and an early start score higher; exact and prefix matches above all.
 */

const EXACT_BONUS = 1 << 20;
const PREFIX_BONUS = 1 << 19;

const fold = (code: number) =>
  code >= 0x41 && code <= 0x5a ? code | 0x20 : code;

function boundaryBonus(name: string, index: number): number {
  if (index === 0) {
    return 10;
  }
  const previous = name.charCodeAt(index - 1);
  if (previous === 0x5f || previous === 0x2d || previous === 0x2e) {
    return 8;
  }
  const current = name.charCodeAt(index);
  const lower = previous >= 0x61 && previous <= 0x7a;
  const upper = current >= 0x41 && current <= 0x5a;

  return lower && upper ? 7 : 0;
}

/** The query folded and stripped of spaces, ready for `fuzzyScore`. */
export function foldQuery(query: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < query.length; i++) {
    const code = query.charCodeAt(i);
    if (code !== 0x20) {
      out.push(fold(code));
    }
  }

  return out;
}

/** Higher is better; null when `needle` isn't a subsequence of `name`. */
export function fuzzyScore(needle: number[], name: string): number | null {
  if (needle.length === 0) {
    return 0;
  }
  // The shortest window ending at the first complete match, as fzf v1.
  let j = 0;
  let end = -1;
  for (let i = 0; i < name.length; i++) {
    if (fold(name.charCodeAt(i)) === needle[j] && ++j === needle.length) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return null;
  }
  j = needle.length - 1;
  let begin = end;
  for (; begin >= 0; begin--) {
    if (fold(name.charCodeAt(begin)) === needle[j]) {
      if (j === 0) {
        break;
      }
      j--;
    }
  }
  let score = 0;
  let previous = -2;
  let streak = 0;
  j = 0;
  for (let i = begin; i <= end && j < needle.length; i++) {
    if (fold(name.charCodeAt(i)) !== needle[j]) {
      continue;
    }
    j++;
    score += 16 + boundaryBonus(name, i);
    if (i === previous + 1) {
      streak++;
      score += 4 * Math.min(streak, 4);
    } else {
      streak = 0;
      if (previous >= 0) {
        score -= Math.min(i - previous - 1, 12);
      }
    }
    previous = i;
  }
  if (begin === 0) {
    score += 12;
    if (needle.length === name.length) {
      score += EXACT_BONUS;
    } else if (end === needle.length - 1) {
      score += PREFIX_BONUS;
    }
  }

  // Ties go to the shorter name.
  return score * 64 - Math.min(name.length, 63);
}
