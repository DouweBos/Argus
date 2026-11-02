import { SegmentedControl } from "@argus/peacock";
import {
  setDiffView,
  setDiffWhitespace,
  useDiffView,
  useDiffWhitespace,
} from "../../../../stores/settingsStore";
import styles from "./DiffToolbar.module.css";

/**
 * Diff-detail toolbar — view mode (Unified/Split) and whitespace.
 * Persisted in the global settings store so the toggles are sticky across
 * files and sessions (per spec §9 "default diff view").
 *
 * NOTE: Whitespace ignore is passed through `getSession*Diff`
 * IPC opts; the rendering side (`FileDiffView`) honours `viewMode`.
 */
export function DiffToolbar() {
  const view = useDiffView();
  const whitespace = useDiffWhitespace();

  return (
    <div className={styles.bar}>
      <div className={styles.toolGroup}>
        <SegmentedControl
          size="sm"
          value={view}
          onChange={(v) => setDiffView(v)}
          aria-label="Diff view mode"
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Split" },
          ]}
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={!whitespace}
            onChange={(e) => setDiffWhitespace(!e.target.checked)}
          />
          Ignore whitespace
        </label>
      </div>
    </div>
  );
}
