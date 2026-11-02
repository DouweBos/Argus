/**
 * `/design?url=&session=&tab=&compare=1`: a Figma frame with its layers,
 * comments and pages, and — opened from a session — against one of the
 * computer's devices. Loaded on first use, like the session tools.
 */

import { useCallback, useEffect, useState } from "react";
import {
  currentFrameKey,
  designChangedSince,
  designSubtitle,
  figmaFrameKey,
  formatDiffering,
  isFigmaUrl,
  sessionRefFor,
} from "@argus/client-core";
import { DesignComparePane, DesignViewer, Select } from "@argus/peacock";
import type { RemoteDevice } from "../../lib/protocol";
import { appNavigate } from "../../routing/router";
import type { Screen } from "../../routing/screens";
import { useConnectionStore } from "../../stores/connection";
import { FIGMA_NOT_CONNECTED, useDesignStore } from "../../stores/design";
import { useDevicesStore } from "../../stores/devices";
import { useProjectsStore } from "../../stores/projects";
import { useLiveRefresh } from "../useLiveRefresh";
import { useDesignComparison } from "./useDesignComparison";

export type DesignScreenState = Extract<Screen, { name: "design" }>;

function deviceValue(device: Pick<RemoteDevice, "id" | "platform">): string {
  return `${device.platform}:${device.id}`;
}

function DeviceCompare({ url }: { url: string }) {
  const connection = useConnectionStore((s) => s.connection);
  const devices = useDevicesStore((s) => s.devices);
  const refreshDevices = useDevicesStore((s) => s.refreshDevices);
  const [picked, setPicked] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => {
    refreshDevices({ background: true }).catch(() => {});
  }, [refreshDevices]);
  useLiveRefresh(connection === "ready", refresh);

  const booted = devices.filter((d) => d.booted && !d.is_tv);
  const device =
    booted.length === 1
      ? booted[0]
      : (booted.find((d) => deviceValue(d) === picked) ?? null);
  const { comparison, error, loading } = useDesignComparison(
    url,
    device?.platform ?? null,
    device?.id ?? null,
    nonce,
  );

  return (
    <DesignComparePane
      comparison={comparison}
      deviceLabel={device?.platform === "android" ? "Emulator" : "Simulator"}
      differing={
        comparison ? formatDiffering(comparison.differingFraction) : null
      }
      error={error}
      hasDevice={!!device}
      leading={
        booted.length > 1 && (
          <Select
            aria-label="Device"
            value={device ? deviceValue(device) : ""}
            onChange={(e) => setPicked(e.target.value || null)}
          >
            <option value="">Pick a device</option>
            {booted.map((d) => (
              <option key={deviceValue(d)} value={deviceValue(d)}>
                {d.name}
              </option>
            ))}
          </Select>
        )
      }
      loading={loading}
      noDeviceHint={
        booted.length > 1
          ? "Pick the device to compare against."
          : "No device running — boot a simulator or emulator in Argus on your computer."
      }
      onRetake={() => setNonce((n) => n + 1)}
    />
  );
}

export default function DesignScreen({
  screen,
}: {
  screen: DesignScreenState;
}) {
  const { url, sessionId, tab, compare } = screen;
  const ready = useConnectionStore((s) => s.connection === "ready");
  const load = useDesignStore((s) => s.frames[url]);
  const loadFrame = useDesignStore((s) => s.loadFrame);
  const session = useProjectsStore((s) =>
    sessionId
      ? Object.values(s.sessionsByRepo)
          .flat()
          .find((x) => x.id === sessionId)
      : undefined,
  );
  const loaded = !!load;

  useEffect(() => {
    if (ready && !loaded) {
      loadFrame(url).catch(() => {});
    }
  }, [loadFrame, loaded, ready, url]);

  const details = load?.details ?? null;
  const error = load?.error ?? null;
  const current = details ? currentFrameKey(details) : null;
  const changed = details
    ? designChangedSince(
        sessionRefFor(session?.design_refs, details.ref),
        details.file.version,
      )
    : false;
  const go = (change: Partial<DesignScreenState>) =>
    appNavigate({ ...screen, ...change }, { replace: true });

  return (
    <DesignViewer
      changed={changed}
      compare={sessionId ? <DeviceCompare url={url} /> : undefined}
      details={details}
      error={error}
      errorTitle={
        error === FIGMA_NOT_CONNECTED
          ? "Figma isn't connected"
          : "Couldn't load the design"
      }
      isCurrentFrame={(frameUrl) => figmaFrameKey(frameUrl) === current}
      mode={compare && sessionId ? "compare" : "frame"}
      onModeChange={
        sessionId ? (mode) => go({ compare: mode === "compare" }) : undefined
      }
      onOpenFrame={(frameUrl) => go({ url: frameUrl, compare: false })}
      onOpenInFigma={() => {
        // The link came from the address bar: only ever hand Figma links on.
        if (isFigmaUrl(url)) {
          window.open(url, "_blank", "noopener");
        }
      }}
      onTabChange={(next) => go({ tab: next })}
      subtitle={details ? designSubtitle(details) : undefined}
      tab={tab}
    />
  );
}
