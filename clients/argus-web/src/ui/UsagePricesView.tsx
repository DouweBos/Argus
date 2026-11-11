/**
 * `/usage/prices`: model prices set by hand, host-wide. Edits stay a draft
 * until Save; the host checks the save and its refusal shows inline. Needs the
 * control grant to change anything.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addPriceDraftRow,
  isEdited,
  placeholderFor,
  priceDraftDirty,
  priceDraftRows,
  priceOverridesFromDraft,
  resetPriceDraftRow,
  type PriceDraftRow,
} from "@argus/client-core";
import { UsagePriceEditor, type UsagePriceRowData } from "@argus/peacock";
import { navigateBack } from "../routing/router";
import { useConnectionStore } from "../stores/connection";
import { useUsageStore } from "../stores/usage";

const PARENT = { name: "usage", tab: "cost", range: "30d" } as const;

function rowData(row: PriceDraftRow): UsagePriceRowData {
  return {
    model: row.model,
    values: {
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheWrite: row.cacheWrite,
    },
    placeholders: {
      input: placeholderFor(row, "input"),
      output: placeholderFor(row, "output"),
      cacheRead: placeholderFor(row, "cacheRead"),
      cacheWrite: placeholderFor(row, "cacheWrite"),
    },
    mapTo: row.mapTo,
    custom: row.saved,
    reset: row.reset,
    resettable: row.saved || !row.list || isEdited(row),
  };
}

export function UsagePricesView() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const prices = useUsageStore((s) => s.prices);
  const pricesLoad = useUsageStore((s) => s.pricesLoad);
  const seed = useUsageStore((s) => s.pricesSeed);
  const { loadPrices, savePrices, seedPrices } = useUsageStore.getState();
  const [rows, setRows] = useState<PriceDraftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ready) {
      loadPrices().catch(() => {});
    }
  }, [ready, loadPrices]);

  // The draft starts from the first answer and keeps the user's edits after.
  useEffect(() => {
    if (prices && rows === null) {
      const start = priceDraftRows(prices);
      setRows(seed ? addPriceDraftRow(start, seed, prices.list) : start);
      seedPrices(null);
    }
  }, [prices, rows, seed, seedPrices]);

  const update = useCallback(
    (model: string, change: (row: PriceDraftRow) => PriceDraftRow | null) => {
      setError(null);
      setRows((current) =>
        (current ?? []).flatMap((r) => {
          if (r.model !== model) {
            return [r];
          }
          const next = change(r);

          return next ? [next] : [];
        }),
      );
    },
    [],
  );

  const dirty = useMemo(
    () => (rows && prices ? priceDraftDirty(rows, prices) : false),
    [rows, prices],
  );
  const close = () => navigateBack(PARENT);

  return (
    <div className="aw-flush">
      <UsagePriceEditor
        disabled={!hasControl}
        dirty={dirty}
        error={error}
        loadError={pricesLoad.error}
        loading={!pricesLoad.loaded}
        rows={(rows ?? []).map(rowData)}
        saving={saving}
        onAdd={(model) => {
          setError(null);
          setRows((current) =>
            addPriceDraftRow(current ?? [], model, prices?.list ?? []),
          );
        }}
        onCancel={close}
        onChange={(model, field, value) =>
          update(model, (r) =>
            field === "mapTo"
              ? { ...r, mapTo: value }
              : { ...r, [field]: value },
          )
        }
        onReset={(model) => update(model, resetPriceDraftRow)}
        onRetry={() => {
          loadPrices().catch(() => {});
        }}
        onSave={() => {
          let overrides;
          try {
            overrides = priceOverridesFromDraft(rows ?? []);
          } catch (e) {
            setError(String(e));

            return;
          }
          setSaving(true);
          savePrices(overrides)
            .then(close)
            .catch((e: unknown) => setError(String(e)))
            .finally(() => setSaving(false));
        }}
        onUndo={(model) => update(model, (r) => ({ ...r, reset: false }))}
      />
    </div>
  );
}
