/**
 * Per-token prices from LiteLLM's public model price list, kept in the Argus
 * home for a day so cost estimates work offline and don't refetch per view.
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
export interface ModelRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
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

/** Claude entries of the LiteLLM document; models without input and output rates are dropped. */
export function parsePriceDocument(doc: unknown): Record<string, ModelRate> {
  const rates: Record<string, ModelRate> = {};
  if (typeof doc !== "object" || doc === null) {
    return rates;
  }
  for (const [name, raw] of Object.entries(doc as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const key = normalizeModelKey(name);
    if (!key.startsWith("claude-")) {
      continue;
    }
    const e = raw as Record<string, unknown>;
    const input = num(e.input_cost_per_token);
    const output = num(e.output_cost_per_token);
    if (input === null || output === null) {
      continue;
    }
    const cacheWrite = num(e.cache_creation_input_token_cost) ?? input;
    // First entry wins: the bare id is listed before regional variants.
    rates[key] ??= {
      input,
      output,
      cacheRead: num(e.cache_read_input_token_cost) ?? input,
      cacheWrite,
      cacheWrite1h:
        num(e.cache_creation_input_token_cost_above_1hr) ?? cacheWrite,
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
  return path.join(argusHomeDir(), "usage-model-prices.json");
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
      throw new Error("no Claude prices in the list");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

let memory: PriceFile | null = null;
let lastAttempt = 0;
let pending: Promise<void> | null = null;

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
