import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, Dialog } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  closeChangelogDialog,
  dismissInstallPrompt,
  downloadNow,
  initUpdaterStore,
  openChangelogDialog,
  quitAndInstall,
  useUpdaterState,
  useUpdaterUi,
} from "../../../stores/updaterStore";
import { Markdown } from "../Markdown/Markdown";
import styles from "./UpdaterHost.module.css";

/**
 * Top-level updater UI:
 *  - subscribes once to backend `updater:state` events
 *  - auto-opens the changelog dialog when an update finishes downloading so
 *    the user sees release notes alongside the restart prompt
 *  - hosts the changelog dialog (also shown via the home banner, the menu bar
 *    "Check for Updates…" item, or programmatically)
 */
export function UpdaterHost() {
  useEffect(() => {
    initUpdaterStore();
  }, []);

  const state = useUpdaterState();
  const ui = useUpdaterUi();

  const shouldAutoOpen =
    state.phase === "downloaded" &&
    state.updateVersion !== null &&
    ui.installPromptDismissedFor !== state.updateVersion &&
    !ui.changelogDialogOpen;

  useEffect(() => {
    if (shouldAutoOpen) {
      openChangelogDialog();
    }
  }, [shouldAutoOpen]);

  return (
    <>
      {ui.changelogDialogOpen &&
        createPortal(<ChangelogDialog />, document.body)}
    </>
  );
}

function ChangelogDialog() {
  const state = useUpdaterState();

  // Once we have an update version, keep showing its notes through every
  // phase (available → downloading → downloaded) so the title and body
  // don't flip back to the currently-installed version while the download
  // is in flight.
  const showingUpdate =
    state.updateVersion !== null &&
    (state.phase === "available" ||
      state.phase === "downloading" ||
      state.phase === "downloaded");

  let body: React.ReactNode;
  if (state.phase === "checking") {
    body = <p className={styles.muted}>Checking for updates…</p>;
  } else if (state.phase === "error") {
    body = (
      <p className={styles.error}>
        Could not check for updates. {state.error ?? ""}
      </p>
    );
  } else if (showingUpdate && state.releaseNotes) {
    body = <Markdown text={state.releaseNotes} className={styles.notes} />;
  } else if (showingUpdate) {
    body = (
      <p className={styles.muted}>
        Release notes for {state.updateVersion} are not available offline. See
        the GitHub release for the full changelog.
      </p>
    );
  } else {
    body = (
      <p className={styles.muted}>
        You&apos;re on the latest version ({state.currentVersion}).
      </p>
    );
  }

  const headerVersion = showingUpdate
    ? state.updateVersion
    : state.currentVersion;

  const onClose = () => {
    if (state.phase === "downloaded") {
      dismissInstallPrompt();
    }
    closeChangelogDialog();
  };

  return (
    <Dialog
      onClose={onClose}
      size="medium"
      title={headerVersion ? `What's new in ${headerVersion}` : "What's new"}
      titleId="updater-changelog"
    >
      <div className={styles.body}>{body}</div>
      <div className={styles.footer}>
        <Button
          variant="ghost"
          onClick={() => {
            openExternalUrl("https://houwert.dev/argus").catch(() => {});
          }}
        >
          View all releases
        </Button>
        <div className={styles.spacer} />
        {state.phase === "available" && (
          <>
            <Button variant="secondary" onClick={closeChangelogDialog}>
              Later
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                downloadNow().catch(() => {});
              }}
            >
              Download update
            </Button>
          </>
        )}
        {state.phase === "downloading" && (
          <>
            <span className={styles.muted}>
              Downloading… {state.progressPercent}%
            </span>
            <Button variant="secondary" onClick={closeChangelogDialog}>
              Close
            </Button>
          </>
        )}
        {state.phase === "downloaded" && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Later
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                closeChangelogDialog();
                await quitAndInstall();
              }}
            >
              Restart & install
            </Button>
          </>
        )}
        {state.phase !== "available" &&
          state.phase !== "downloading" &&
          state.phase !== "downloaded" && (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
      </div>
    </Dialog>
  );
}
