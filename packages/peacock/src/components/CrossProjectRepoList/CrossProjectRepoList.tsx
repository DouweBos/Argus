import { CheckIcon, ChevronRightIcon } from "../../icons/Icons";
import { Badge, type BadgeTone } from "../Badge/Badge";
import { ProjectBadge } from "../ProjectBadge/ProjectBadge";
import styles from "./CrossProjectRepoList.module.css";

export interface CrossProjectRepoItem {
  sessionId: string;
  repoRoot: string;
  name: string;
  branch: string;
  /** Setup or pull request state; none for a ready repository without a PR. */
  state?: { label: string; tone: BadgeTone } | null;
}

export interface CrossProjectRepoListProps {
  repos: CrossProjectRepoItem[];
  /** The repository on screen, marked instead of offered. */
  currentSessionId: string;
  onSelect: (repo: CrossProjectRepoItem) => void;
}

/** A cross-project session's repositories, one row each; picking one opens its own changes. */
export function CrossProjectRepoList({
  repos,
  currentSessionId,
  onSelect,
}: CrossProjectRepoListProps) {
  return (
    <div className={styles.list} role="list">
      {repos.map((repo) => {
        const current = repo.sessionId === currentSessionId;

        return (
          <button
            key={repo.sessionId}
            type="button"
            role="listitem"
            aria-current={current ? "true" : undefined}
            className={[styles.row, current ? styles.current : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              if (!current) {
                onSelect(repo);
              }
            }}
          >
            <ProjectBadge name={repo.name} projectKey={repo.repoRoot} />
            <span className={styles.text}>
              <span className={styles.name}>{repo.name}</span>
              <span className={styles.branch}>{repo.branch}</span>
            </span>
            {repo.state && (
              <Badge tone={repo.state.tone} size="tag">
                {repo.state.label}
              </Badge>
            )}
            <span className={styles.trailing}>
              {current ? (
                <CheckIcon size={12} />
              ) : (
                <ChevronRightIcon size={8} />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
