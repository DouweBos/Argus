import type { DesignRef } from "../../../lib/types";
import { useEffect, useState } from "react";
import { Button, Icons, ImageDiff, Select, Spinner } from "@argus/peacock";
import { getFigmaFrame, takeDeviceScreenshot } from "../../../lib/ipc";
import { capture } from "../../../lib/telemetry";
import styles from "./DesignCompare.module.css";

interface DesignCompareProps {
  deviceKey: string | null;
  platform: "android" | "ios";
  refs: DesignRef[];
}

interface Result {
  design: string | null;
  error: string | null;
  key: string;
  shot: string | null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The session's Figma frame next to what the device shows, side by side or
 * under a slider. The screenshot is a snapshot — refresh after a change.
 */
export function DesignCompare({
  deviceKey,
  platform,
  refs,
}: DesignCompareProps) {
  const [index, setIndex] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const ref = refs[Math.min(index, refs.length - 1)];
  const key = `${ref?.url ?? ""}|${deviceKey ?? ""}|${nonce}`;
  const current = result?.key === key ? result : null;
  const loading = current === null;
  const { design = null, shot = null, error = null } = current ?? {};

  useEffect(() => {
    capture("design_compare_opened");
  }, []);

  useEffect(() => {
    if (!ref) {
      return;
    }
    let cancelled = false;
    Promise.all([
      getFigmaFrame(ref.url),
      deviceKey
        ? takeDeviceScreenshot(platform, deviceKey)
        : Promise.resolve(null),
    ]).then(
      ([frame, png]) =>
        !cancelled &&
        setResult({
          key,
          design: frame ? `data:image/png;base64,${frame.image}` : null,
          shot: png ? `data:image/png;base64,${png}` : null,
          error: null,
        }),
      (err: unknown) =>
        !cancelled &&
        setResult({ key, design: null, shot: null, error: message(err) }),
    );

    return () => {
      cancelled = true;
    };
  }, [deviceKey, key, platform, ref]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {refs.length > 1 ? (
          <Select
            aria-label="Design frame"
            value={String(index)}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {refs.map((r, i) => (
              <option key={r.url} value={i}>
                {r.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className={styles.name}>{ref?.name}</span>
        )}
        <span className={styles.spacer} />
        {loading && <Spinner size="xs" tone="muted" />}
        <Button
          variant="ghost"
          leading={<Icons.RefreshIcon size={11} />}
          disabled={loading}
          onClick={() => setNonce((n) => n + 1)}
        >
          Retake screenshot
        </Button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {!error && !loading && !shot && (
        <p className={styles.hint}>
          No device to compare yet — boot one and retake the screenshot.
        </p>
      )}
      {!error && (design || shot) && (
        <div className={styles.diff}>
          <ImageDiff
            before={design ?? undefined}
            after={shot ?? undefined}
            beforeLabel="Design"
            afterLabel={platform === "ios" ? "Simulator" : "Emulator"}
          />
        </div>
      )}
    </div>
  );
}
