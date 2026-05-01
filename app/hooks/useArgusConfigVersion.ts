import { useState } from "react";
import { useIpcEvent } from "./useIpcEvent";

/**
 * Returns a counter that increments whenever `.argus.json` is rewritten for
 * the given repo. Add to a `useEffect` deps array to re-run the effect when
 * project settings are saved, so live UI (deep links, run commands, protected
 * branches) reflects the new config without a navigation round-trip.
 */
export function useArgusConfigVersion(repoRoot: string | null): number {
  const [nonce, setNonce] = useState(0);
  useIpcEvent<{ repoRoot: string }>("argus_config:changed", (payload) => {
    if (repoRoot && payload.repoRoot === repoRoot) {
      setNonce((n) => n + 1);
    }
  });

  return nonce;
}
