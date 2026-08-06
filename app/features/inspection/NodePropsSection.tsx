import type { NodeProps } from "../../lib/ipc";
import { useEffect, useState } from "react";
import { inspectionNodeProps } from "../../lib/ipc";
import styles from "./NodeMetadataPanel.module.css";

interface FetchState {
  data: NodeProps | null;
  failed: boolean;
  nodeId: string;
}

/**
 * React Native props for the selected node, fetched lazily from the in-process
 * `/props` endpoint. Renders the raw JS prop bag when available (falling back to
 * the native `ViewProps`), and quietly renders nothing for non-Fabric views or
 * when the endpoint isn't present (older dylib) — so it degrades gracefully.
 */
export function NodePropsSection({
  deviceKey,
  nodeId,
}: {
  deviceKey: string | null;
  nodeId: string;
}) {
  const [state, setState] = useState<FetchState | null>(null);

  useEffect(() => {
    if (!deviceKey) {
      return;
    }
    let cancelled = false;
    inspectionNodeProps(deviceKey, nodeId)
      .then((data) => {
        if (!cancelled) {
          setState({ nodeId, data, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ nodeId, data: null, failed: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deviceKey, nodeId]);

  // Only trust state that belongs to the currently-selected node.
  const current = state && state.nodeId === nodeId ? state : null;
  if (
    !deviceKey ||
    !current ||
    current.failed ||
    !current.data ||
    current.data.isFabric === false
  ) {
    return null;
  }

  const { props, rawProps, note } = current.data;
  const bag = rawProps ?? props;
  const hasBag = bag && Object.keys(bag).length > 0;

  if (!hasBag && !note) {
    return null;
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        React props{hasBag && !rawProps ? " (native)" : ""}
      </div>
      {hasBag && (
        <pre className={styles.propsBlock}>{JSON.stringify(bag, null, 2)}</pre>
      )}
      {note && <div className={styles.propsNote}>{note}</div>}
    </div>
  );
}
