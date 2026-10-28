import type { DesignComparison } from "../../../lib/types";
import { useEffect, useState } from "react";
import { compareDesign } from "../../../lib/ipc";

interface Result {
  comparison: DesignComparison | null;
  error: string | null;
  key: string;
}

/**
 * The host's render-and-diff of a frame against a device. Re-runs when the
 * frame, the device or `nonce` change; the screenshot is a snapshot.
 */
export function useDesignComparison(
  url: string,
  platform: "android" | "ios",
  deviceKey: string | null,
  nonce: number,
) {
  const [result, setResult] = useState<Result | null>(null);
  const key = `${url}|${platform}|${deviceKey ?? ""}|${nonce}`;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    if (!deviceKey) {
      return;
    }
    let cancelled = false;
    compareDesign(url, platform, deviceKey).then(
      (comparison) => !cancelled && setResult({ key, comparison, error: null }),
      (err: unknown) =>
        !cancelled &&
        setResult({
          key,
          comparison: null,
          error: err instanceof Error ? err.message : String(err),
        }),
    );

    return () => {
      cancelled = true;
    };
  }, [deviceKey, key, platform, url]);

  return {
    comparison: current?.comparison ?? null,
    error: current?.error ?? null,
    loading: !!deviceKey && current === null,
  };
}

/** `4.2%` — the share of pixels that differ noticeably. */
export function formatDiffering(fraction: number): string {
  const pct = fraction * 100;

  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}
