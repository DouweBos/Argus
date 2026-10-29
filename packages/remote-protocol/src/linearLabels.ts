/** How Linear names priorities and estimates, shared so every client says the same. */

export const PRIORITY_NAMES: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

/** Linear stores t-shirt sizes as these numbers. */
const T_SHIRT: Record<number, string> = {
  0: "None",
  1: "XS",
  2: "S",
  3: "M",
  5: "L",
  8: "XL",
  13: "XXL",
  21: "XXXL",
};

/** `M` on a t-shirt team, `3 pt` elsewhere. */
export function estimateName(
  estimate: number,
  estimateType: string | null | undefined,
): string {
  if (estimateType === "tShirt" && T_SHIRT[estimate]) {
    return T_SHIRT[estimate];
  }

  return `${estimate} pt`;
}
