import type { ReactNode } from "react";
import { useState } from "react";
import { formatDiffering } from "@argus/client-core";
import { DesignComparePane as ComparePane } from "@argus/peacock";
import { useDesignComparison } from "./useDesignComparison";

interface DesignComparePaneProps {
  deviceKey: string | null;
  /** Toolbar content before the result, e.g. a frame picker. */
  leading?: ReactNode;
  platform: "android" | "ios";
  /** Toolbar content after Retake. */
  trailing?: ReactNode;
  url: string;
}

/** The host's render-and-diff of a frame against the device, wired to Peacock's pane. */
export function DesignComparePane({
  deviceKey,
  leading,
  platform,
  trailing,
  url,
}: DesignComparePaneProps) {
  const [nonce, setNonce] = useState(0);
  const { comparison, error, loading } = useDesignComparison(
    url,
    platform,
    deviceKey,
    nonce,
  );

  return (
    <ComparePane
      comparison={comparison}
      deviceLabel={platform === "ios" ? "Simulator" : "Emulator"}
      differing={
        comparison ? formatDiffering(comparison.differingFraction) : null
      }
      error={error}
      hasDevice={!!deviceKey}
      leading={leading}
      loading={loading}
      onRetake={() => setNonce((n) => n + 1)}
      trailing={trailing}
    />
  );
}
