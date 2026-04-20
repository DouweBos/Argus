import { useCallback, useEffect, useState } from "react";
import { readExistingArgusJson } from "../lib/ipc";

interface ArgusJsonState {
  exists: boolean | null;
  loading: boolean;
  refresh: () => void;
}

export function useArgusJson(repoRoot: string | null): ArgusJsonState {
  const [exists, setExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!repoRoot) {
      setExists(null);

      return;
    }
    let cancelled = false;
    setLoading(true);
    readExistingArgusJson(repoRoot)
      .then((cfg) => {
        if (!cancelled) {
          setExists(cfg !== null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExists(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, nonce]);

  return { exists, loading, refresh };
}
