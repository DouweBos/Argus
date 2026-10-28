import type { FigmaFrameDetails } from "../../../lib/types";
import { useEffect, useState } from "react";
import { getFigmaFrameDetails } from "../../../lib/ipc";

interface Result {
  details: FigmaFrameDetails | null;
  error: string | null;
  url: string;
}

/** The frame, its layers, comments and file outline for the viewer. */
export function useFrameDetails(url: string) {
  const [result, setResult] = useState<Result | null>(null);
  const current = result?.url === url ? result : null;

  useEffect(() => {
    let cancelled = false;
    getFigmaFrameDetails(url).then(
      (details) =>
        !cancelled &&
        setResult({
          url,
          details,
          error: details ? null : "Figma has no frame at this link.",
        }),
      (err: unknown) =>
        !cancelled &&
        setResult({
          url,
          details: null,
          error: err instanceof Error ? err.message : String(err),
        }),
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  return {
    details: current?.details ?? null,
    error: current?.error ?? null,
  };
}
