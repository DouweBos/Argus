/**
 * Rates for the speed tier a request ran at: the price list's own fast and
 * ultrafast rates where it has them, else the provider's published multiple.
 */

import type { UsageSpeed } from "@argus/remote-protocol";
import {
  normalizeModelKey,
  scaleRates,
  type ModelRate,
  type TokenRates,
} from "./pricing";

type PremiumTier = Exclude<UsageSpeed, "standard">;

/**
 * Anthropic bills fast mode at 2x standard; OpenAI bills priority processing
 * (Codex's fast tier) at 2x. Neither publishes a general ultrafast multiple.
 */
const PROVIDER_MULTIPLES: {
  match: RegExp;
  multiples: Partial<Record<PremiumTier, number>>;
}[] = [
  { match: /^claude-/, multiples: { fast: 2 } },
  { match: /^(gpt-|o\d|codex)/, multiples: { fast: 2 } },
];

function providerMultiple(model: string, tier: PremiumTier): number | null {
  const key = normalizeModelKey(model);

  return (
    PROVIDER_MULTIPLES.find((p) => p.match.test(key))?.multiples[tier] ?? null
  );
}

/** Rates at `speed`; an ultrafast tier nobody prices falls back to fast, then standard. */
export function ratesAt(
  rate: ModelRate,
  speed: UsageSpeed | undefined,
  model: string,
): TokenRates {
  if (!speed || speed === "standard") {
    return rate;
  }
  const tiers: PremiumTier[] =
    speed === "ultrafast" ? ["ultrafast", "fast"] : ["fast"];
  for (const tier of tiers) {
    const listed = rate[tier];
    if (listed) {
      return listed;
    }
    const multiple = providerMultiple(model, tier);
    if (multiple !== null) {
      return scaleRates(rate, multiple);
    }
  }

  return rate;
}
