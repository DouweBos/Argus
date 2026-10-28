import type { Platform, RuntimeMode } from "../../../stores/simulatorStore";
import { useEffect, useMemo } from "react";
import { useSessions } from "../../../stores/sessionStore";

/**
 * The runtime-mode segments. `Simulate` is core; `Inspect` is contributed by
 * `device-inspector` on Apple platforms; `Design` appears once the session has
 * Figma frames. A mode that stops applying snaps back to simulate.
 */
export function useRuntimeModes({
  inspectorEnabled,
  platform,
  runtimeMode,
  sessionId,
  setRuntimeMode,
}: {
  inspectorEnabled: boolean;
  platform: Platform;
  runtimeMode: RuntimeMode;
  sessionId: string | null;
  setRuntimeMode: (mode: RuntimeMode) => void;
}) {
  const designRefs =
    useSessions().find((s) => s.id === sessionId)?.design_refs ?? null;
  const designPlatform =
    platform === "ios" || platform === "android" ? platform : null;
  const designEnabled = !!designRefs?.length && designPlatform !== null;

  const runtimeModeOptions = useMemo(
    () => [
      { label: "Simulate", value: "simulate" as const },
      ...(inspectorEnabled
        ? [{ label: "Inspect", value: "inspect" as const }]
        : []),
      ...(designEnabled ? [{ label: "Design", value: "design" as const }] : []),
    ],
    [designEnabled, inspectorEnabled],
  );

  useEffect(() => {
    if (
      (!inspectorEnabled && runtimeMode === "inspect") ||
      (!designEnabled && runtimeMode === "design")
    ) {
      setRuntimeMode("simulate");
    }
  }, [designEnabled, inspectorEnabled, runtimeMode, setRuntimeMode]);

  return { designEnabled, designPlatform, designRefs, runtimeModeOptions };
}
