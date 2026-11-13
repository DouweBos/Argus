/**
 * Per-token prices for every provider's chat models from LiteLLM's public price
 * list, kept in the Argus home for a day so estimates work offline and don't
 * refetch per view.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";

const PRICE_URLS = [
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  "https://api.github.com/repos/BerriAI/litellm/contents/model_prices_and_context_window.json?ref=main",
];
const TTL_MS = 24 * 60 * 60_000;
const RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 20_000;

/** Dollars per token. Cache rates fall back to the input rate when unlisted. */
export interface TokenRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
}

/** Standard rates, plus the fast and ultrafast tiers when the list prices them. */
export interface ModelRate extends TokenRates {
  fast?: TokenRates;
  ultrafast?: TokenRates;
}

export type RateTable = Map<string, ModelRate>;

interface PriceFile {
  fetchedAt: number;
  rates: Record<string, ModelRate>;
}

/** Placeholders the CLI writes for turns that never reached a model. */
const UNPRICED = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

/** `claude-opus-4[1m]` → `claude-opus-4`; drops a `provider/` prefix. */
export function normalizeModelKey(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/^[a-z0-9_-]+\//, "");
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

export function scaleRates(rates: TokenRates, by: number): TokenRates {
  return {
    input: rates.input * by,
    output: rates.output * by,
    cacheRead: rates.cacheRead * by,
    cacheWrite: rates.cacheWrite * by,
    cacheWrite1h: rates.cacheWrite1h * by,
  };
}

/**
 * A tier's rates from `<field><suffix>`; a cache rate the tier doesn't list
 * keeps its standard ratio to the input rate.
 */
function tierRates(
  e: Record<string, unknown>,
  suffix: string,
  standard: TokenRates,
): TokenRates | undefined {
  const input = num(e[`input_cost_per_token${suffix}`]);
  const output = num(e[`output_cost_per_token${suffix}`]);
  if (input === null || output === null) {
    return undefined;
  }
  const ratio = (v: number) =>
    standard.input > 0 ? (v / standard.input) * input : input;
  const cacheWrite =
    num(e[`cache_creation_input_token_cost${suffix}`]) ??
    ratio(standard.cacheWrite);

  return {
    input,
    output,
    cacheRead:
      num(e[`cache_read_input_token_cost${suffix}`]) ??
      ratio(standard.cacheRead),
    cacheWrite,
    cacheWrite1h:
      standard.cacheWrite > 0
        ? (standard.cacheWrite1h / standard.cacheWrite) * cacheWrite
        : cacheWrite,
  };
}

/** Anthropic lists fast mode as a multiple of the standard price. */
function fastMultiple(e: Record<string, unknown>): number | null {
  const specific = e.provider_specific_entry;
  if (typeof specific !== "object" || specific === null) {
    return null;
  }
  const fast = num((specific as Record<string, unknown>).fast);

  return fast !== null && fast > 0 ? fast : null;
}

/** Price-list modes that bill per token for chat turns. */
const TOKEN_MODES = new Set(["chat", "responses"]);

/**
 * Chat models of the LiteLLM document, every provider. A bare id wins over a
 * `provider/` one that normalizes to it; models without input and output
 * rates are dropped.
 */
export function parsePriceDocument(doc: unknown): Record<string, ModelRate> {
  const rates: Record<string, ModelRate> = {};
  if (typeof doc !== "object" || doc === null) {
    return rates;
  }
  const entries = Object.entries(doc as Record<string, unknown>);
  const bareFirst = [
    ...entries.filter(([name]) => !name.includes("/")),
    ...entries.filter(([name]) => name.includes("/")),
  ];
  for (const [name, raw] of bareFirst) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const e = raw as Record<string, unknown>;
    if (typeof e.mode === "string" && !TOKEN_MODES.has(e.mode)) {
      continue;
    }
    const input = num(e.input_cost_per_token);
    const output = num(e.output_cost_per_token);
    if (input === null || output === null) {
      continue;
    }
    const key = normalizeModelKey(name);
    if (rates[key]) {
      // First entry wins: the bare id is listed before regional variants.
      continue;
    }
    const cacheWrite = num(e.cache_creation_input_token_cost) ?? input;
    const standard: TokenRates = {
      input,
      output,
      cacheRead: num(e.cache_read_input_token_cost) ?? input,
      cacheWrite,
      cacheWrite1h:
        num(e.cache_creation_input_token_cost_above_1hr) ?? cacheWrite,
    };
    const multiple = fastMultiple(e);
    const fast =
      multiple === null
        ? tierRates(e, "_priority", standard)
        : scaleRates(standard, multiple);
    const ultrafast = tierRates(e, "_ultrafast", standard);
    rates[key] = {
      ...standard,
      ...(fast ? { fast } : {}),
      ...(ultrafast ? { ultrafast } : {}),
    };
  }

  return rates;
}

/** Exact id, then without a trailing date stamp (`-20251001`). */
export function rateFor(table: RateTable, model: string): ModelRate | null {
  const key = normalizeModelKey(model);
  if (UNPRICED.has(key)) {
    return null;
  }

  return table.get(key) ?? table.get(key.replace(/-\d{8}$/, "")) ?? null;
}

function cachePath(): string {
  return path.join(argusHomeDir(), "usage-model-prices-v3.json");
}

function readCache(): PriceFile | null {
  try {
    const file = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as PriceFile;

    return typeof file.fetchedAt === "number" && file.rates ? file : null;
  } catch {
    return null;
  }
}

async function download(): Promise<Record<string, ModelRate>> {
  let lastError: unknown = null;
  for (const url of PRICE_URLS) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.github.raw+json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const rates = parsePriceDocument(await res.json());
      if (Object.keys(rates).length > 0) {
        return rates;
      }
      throw new Error("no model prices in the list");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

let memory: PriceFile | null = null;
let lastAttempt = 0;
let pending: Promise<void> | null = null;

/**
 * The table already in memory or on disk, without waiting on a download; null
 * before the first one. Kicks off a refresh when stale.
 */
export function cachedRateTable(): RateTable | null {
  loadRateTable().catch(() => undefined);

  return memory ? new Map(Object.entries(memory.rates)) : null;
}

/** The freshest table available; refetches in the background once stale. */
export async function loadRateTable(): Promise<{
  table: RateTable;
  fetchedAt: number | null;
}> {
  memory ??= readCache();
  const stale = !memory || Date.now() - memory.fetchedAt > TTL_MS;
  if (stale && !pending && Date.now() - lastAttempt > RETRY_MS) {
    lastAttempt = Date.now();
    pending = download()
      .then((rates) => {
        memory = { fetchedAt: Date.now(), rates };
        try {
          fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
          fs.writeFileSync(cachePath(), JSON.stringify(memory));
        } catch (e) {
          warn("[usage] could not cache model prices:", e);
        }
      })
      .catch((e) => warn(`[usage] model price list unavailable: ${String(e)}`))
      .finally(() => {
        pending = null;
      });
  }
  // Without any table yet, wait for the first download rather than show $0.
  if (!memory && pending) {
    await pending;
  }

  return {
    table: new Map(Object.entries(memory?.rates ?? {})),
    fetchedAt: memory?.fetchedAt ?? null,
  };
}

export interface CostParts {
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
}

/** Dollars by token kind at a model's rates. */
export function costParts(
  rate: TokenRates,
  t: {
    input: number;
    cacheRead: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
    output: number;
  },
): CostParts {
  return {
    input: t.input * rate.input,
    cache_read: t.cacheRead * rate.cacheRead,
    cache_write:
      t.cacheWrite5m * rate.cacheWrite + t.cacheWrite1h * rate.cacheWrite1h,
    output: t.output * rate.output,
  };
}

export const partsTotal = (p: CostParts): number =>
  p.input + p.cache_read + p.cache_write + p.output;
