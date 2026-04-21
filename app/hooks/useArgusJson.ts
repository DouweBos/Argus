import { useCallback, useEffect, useState } from "react";
import { readExistingArgusJson } from "../lib/ipc";

interface ArgusJsonState {
  exists: boolean | null;
  loading: boolean;
  refresh: () => void;
}

interface TrackedState {
  exists: boolean | null;
  loading: boolean;
  nonce: number;
  repoRoot: string | null;
}

export function useArgusJson(repoRoot: string | null): ArgusJsonState {
  const [tracked, setTracked] = useState<TrackedState>({
    exists: null,
    loading: repoRoot !== null,
    nonce: 0,
    repoRoot,
  });

  if (tracked.repoRoot !== repoRoot) {
    setTracked({
      exists: null,
      loading: repoRoot !== null,
      nonce: 0,
      repoRoot,
    });
  }

  const refresh = useCallback(() => {
    setTracked((prev) => ({ ...prev, loading: true, nonce: prev.nonce + 1 }));
  }, []);

  const { nonce } = tracked;

  useEffect(() => {
    if (!repoRoot) {
      return undefined;
    }
    let cancelled = false;
    readExistingArgusJson(repoRoot)
      .then((cfg) => {
        if (cancelled) {
          return;
        }
        setTracked((prev) =>
          prev.repoRoot === repoRoot
            ? { ...prev, exists: cfg !== null, loading: false }
            : prev,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTracked((prev) =>
          prev.repoRoot === repoRoot
            ? { ...prev, exists: false, loading: false }
            : prev,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, nonce]);

  const exists = tracked.repoRoot === repoRoot ? tracked.exists : null;
  const loading = tracked.repoRoot === repoRoot ? tracked.loading : false;

  return { exists, loading, refresh };
}
