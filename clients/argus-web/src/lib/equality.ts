/** Cheap deep-equality via JSON: transcript pages are small and refreshed rarely. */
export const jsonEq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** True when two arrays hold the same element references in order. */
export const sameRefs = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
