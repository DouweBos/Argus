/**
 * A line diff (Myers) that answers, for each line of the new text, which line
 * of the old text it is: the one thing attribution needs to carry marks over.
 */

/** Past this many edits the middle counts as rewritten rather than searched. */
const MAX_EDITS = 1000;

/** For each index of `b`, the index of the same line in `a`, or -1 when it's new. */
export function matchLines(
  a: readonly string[],
  b: readonly string[],
): Int32Array {
  const map = new Int32Array(b.length).fill(-1);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    map[start] = start;
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    map[endB] = endA;
  }
  myers(a, b, start, endA, endB, map);

  return map;
}

function myers(
  a: readonly string[],
  b: readonly string[],
  start: number,
  endA: number,
  endB: number,
  map: Int32Array,
): void {
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) {
    return;
  }
  const max = n + m;
  const limit = Math.min(max, MAX_EDITS);
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  // trace[d] is v before step d, kept for k in [-d, d] at index k + d.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        backtrack(trace, d, n, m, start, map);

        return;
      }
    }
  }
}

function backtrack(
  trace: Int32Array[],
  edits: number,
  n: number,
  m: number,
  start: number,
  map: Int32Array,
): void {
  let x = n;
  let y = m;
  for (let d = edits; d > 0; d--) {
    const prev = trace[d]!;
    const at = (k: number) => prev[k + d]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const snakeX = down ? prevX : prevX + 1;
    while (x > snakeX) {
      x -= 1;
      y -= 1;
      map[start + y] = start + x;
    }
    x = prevX;
    y = prevX - prevK;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    map[start + y] = start + x;
  }
}
