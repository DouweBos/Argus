import {
  FolderIcon,
  ArrowBackIcon,
  HomeIcon,
  RepoIcon,
} from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { Spinner } from "../Spinner/Spinner";
import styles from "./DirectoryBrowser.module.css";

export interface DirectoryBrowserEntry {
  /** Marks a directory that already looks like a git repo. */
  isRepo?: boolean;
  name: string;
  path: string;
}

export interface DirectoryBrowserProps {
  entries: DirectoryBrowserEntry[];
  error?: string | null;
  loading?: boolean;
  /** Absolute parent directory, or null at the filesystem root. */
  parent?: string | null;
  /** Directory currently listed. */
  path: string;
  selectedPath?: string | null;
  onHome?: () => void;
  /** Walk into a directory. */
  onNavigate: (path: string) => void;
  /** Highlight a directory without walking into it. */
  onSelect?: (path: string) => void;
}

/**
 * Browses a directory tree supplied by the caller — no filesystem access of its
 * own, so it works equally against this Mac and a remote host's disk.
 */
export function DirectoryBrowser({
  entries,
  error,
  loading,
  parent,
  path,
  selectedPath,
  onHome,
  onNavigate,
  onSelect,
}: DirectoryBrowserProps) {
  return (
    <div className={styles.browser}>
      <div className={styles.toolbar}>
        <button
          className={styles.toolButton}
          disabled={!parent}
          title="Up one level"
          type="button"
          onClick={() => parent && onNavigate(parent)}
        >
          <ArrowBackIcon size={12} />
        </button>
        {onHome && (
          <button
            className={styles.toolButton}
            title="Home"
            type="button"
            onClick={onHome}
          >
            <HomeIcon size={12} />
          </button>
        )}
        <span className={styles.path} title={path}>
          {path}
        </span>
        {loading && <Spinner size="xs" />}
      </div>

      {error ? (
        <p className={styles.error}>{error}</p>
      ) : (
        <ul className={styles.list}>
          {entries.length === 0 && !loading && (
            <li className={styles.empty}>No folders here.</li>
          )}
          {entries.map((entry) => (
            <li key={entry.path}>
              <button
                className={[
                  styles.row,
                  entry.path === selectedPath ? styles.selected : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                onClick={() => onSelect?.(entry.path)}
                onDoubleClick={() => onNavigate(entry.path)}
              >
                {entry.isRepo ? (
                  <RepoIcon size={13} />
                ) : (
                  <FolderIcon size={13} />
                )}
                <span className={styles.name}>{entry.name}</span>
                {entry.isRepo && <Badge tone="accent">repo</Badge>}
                <span
                  className={styles.enter}
                  role="presentation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(entry.path);
                  }}
                >
                  Open
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
