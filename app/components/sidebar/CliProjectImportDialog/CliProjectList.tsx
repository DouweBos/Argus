import type { CliProjectPicker } from "./useCliProjectPicker";
import { CheckboxRow } from "@argus/peacock";
import {
  formatChatCount,
  formatShortAge,
  truncateMiddle,
} from "../../../lib/cliProjectImport";
import styles from "./CliProjectList.module.css";

const PATH_MAX = 64;

/** The picker's rows with select all / none; `showAdded` greys in existing projects. */
export function CliProjectList({
  picker,
  showAdded = true,
}: {
  picker: CliProjectPicker;
  showAdded?: boolean;
}) {
  const { scan, picked, suggestions, importing, now } = picker;
  const rows = showAdded ? (scan?.candidates ?? []) : suggestions;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span>
          {picked.size} of {suggestions.length} selected
        </span>
        <span className={styles.headerActions}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() =>
              picker.setPicked(new Set(suggestions.map((c) => c.path)))
            }
          >
            Select all
          </button>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => picker.setPicked(new Set())}
          >
            Select none
          </button>
        </span>
      </div>
      <div className={styles.list}>
        {rows.map((c) => (
          <CheckboxRow
            key={c.path}
            checked={c.added || picked.has(c.path)}
            disabled={c.added || importing}
            label={c.name}
            detail={truncateMiddle(c.path, PATH_MAX)}
            detailTitle={c.path}
            trailing={
              c.added ? (
                "Added"
              ) : (
                <>
                  <span>{formatChatCount(c.chat_count)}</span>
                  <span className={styles.age}>
                    {formatShortAge(c.last_active_at, now)}
                  </span>
                </>
              )
            }
            onChange={(on) => picker.toggle(c.path, on)}
          />
        ))}
      </div>
      {scan?.truncated && (
        <p className={styles.note}>
          Only the newest chats were scanned; some projects may be missing.
        </p>
      )}
    </div>
  );
}
