/**
 * Compile-time proof that a catalog model and the host type it mirrors are the
 * same shape, so neither can grow a field the other lacks.
 */

export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export type Expect<T extends true> = T;
