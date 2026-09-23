import type { Session } from "../../../lib/types";
import { Button, EmptyState, Icons } from "@argus/peacock";
import { listSessions } from "../../../lib/ipc";
import {
  mergeSessionsForProject,
  selectSession,
} from "../../../stores/sessionStore";
import styles from "./SessionUnavailable.module.css";

interface SessionUnavailableProps {
  /** The repo-root session, which lives on the internal disk and still works. */
  projectSessionId?: string;
  session: Session;
}

/**
 * Stands in for every panel of a session whose drive is disconnected.
 *
 * The URL is deliberately left pointing here: plugging the drive back in
 * should put the user exactly where they were, and a redirect would throw
 * that away.
 */
export function SessionUnavailable({
  projectSessionId,
  session,
}: SessionUnavailableProps) {
  const volume = session.unavailable_volume?.split("/").pop();

  const checkAgain = () => {
    listSessions(session.repo_root)
      .then((sessions) => mergeSessionsForProject(session.repo_root, sessions))
      .catch(() => undefined);
  };

  return (
    <div className={styles.wrap}>
      <EmptyState
        icon={<Icons.DriveIcon size={28} />}
        title={`${session.display_name ?? session.branch} isn't available`}
        body={
          volume
            ? `It's stored on ${volume}, which isn't connected. Reconnect the drive and this session comes back as you left it.`
            : "The folder holding this session can't be reached right now."
        }
        action={
          <div className={styles.actions}>
            <Button variant="primary" onClick={checkAgain}>
              Check again
            </Button>
            {projectSessionId && (
              <Button
                variant="ghost"
                onClick={() => selectSession(projectSessionId)}
              >
                Go to project home
              </Button>
            )}
          </div>
        }
      />
      <p className={styles.path}>{session.path}</p>
    </div>
  );
}
