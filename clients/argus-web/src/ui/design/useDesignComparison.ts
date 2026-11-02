import { useEffect, useState } from "react";
import type { DesignComparison } from "@argus/remote-protocol";
import type { RemotePlatform } from "../../lib/protocol";
import { designErrorMessage, useDesignStore } from "../../stores/design";

interface Result {
  comparison: DesignComparison | null;
  error: string | null;
  key: string;
}

/**
 * The computer's render-and-diff of a frame against a device. Re-runs when
 * the frame, the device or `nonce` change; the screenshot is a snapshot.
 */
export function useDesignComparison(
  url: string,
  platform: RemotePlatform | null,
  deviceKey: string | null,
  nonce: number,
) {
  const compare = useDesignStore((s) => s.compare);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${url}|${platform ?? ""}|${deviceKey ?? ""}|${nonce}`;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    if (!platform || !deviceKey) {
      return;
    }
    let cancelled = false;
    compare(url, platform, deviceKey).then(
      (comparison) => !cancelled && setResult({ key, comparison, error: null }),
      (error: unknown) =>
        !cancelled &&
        setResult({ key, comparison: null, error: designErrorMessage(error) }),
    );

    return () => {
      cancelled = true;
    };
  }, [compare, deviceKey, key, platform, url]);

  return {
    comparison: current?.comparison ?? null,
    error: current?.error ?? null,
    loading: !!platform && !!deviceKey && current === null,
  };
}
