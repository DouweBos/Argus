import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, ConfirmDialog, Dialog } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  closeChangelogDialog,
  dismissInstallPrompt,
  initUpdaterStore,
  quitAndInstall,
  useUpdaterState,
  useUpdaterUi,
} from "../../../stores/updaterStore";
import { Markdown } from "../Markdown/Markdown";
import styles from "./UpdaterHost.module.css";

/**
 * Top-level updater UI:
 *  - subscribes once to backend `updater:state` events
 *  - surfaces a "restart now / later" confirm dialog when an update finishes
 *    downloading
 *  - hosts the changelog dialog (shown via the home banner, the menu bar
 *    "Check for Updates…" item, or programmatically)
 */
export function UpdaterHost() {
  useEffect(() => {
    initUpdaterStore();
  }, []);

  const state = useUpdaterState();
  const ui = useUpdaterUi();

  const showInstallPrompt =
    state.phase === "downloaded" &&
    state.updateVersion !== null &&
    ui.installPromptDismissedFor !== state.updateVersion;

  return (
    <>
      {showInstallPrompt &&
        createPortal(
          <ConfirmDialog
            title="Update ready"
            titleId="updater-install-prompt"
            cancelLabel="Later"
            confirmLabel="Restart & install"
            onCancel={dismissInstallPrompt}
            onConfirm={async () => {
              await quitAndInstall();
            }}
          >
            <div>
              Argus {state.updateVersion} has been downloaded. Restart now to
              install? Running agents will be stopped.
            </div>
          </ConfirmDialog>,
          document.body,
        )}

      {ui.changelogDialogOpen &&
        createPortal(<ChangelogDialog />, document.body)}
    </>
  );
}

function ChangelogDialog() {
  const state = useUpdaterState();

  let body: React.ReactNode;
  if (state.phase === "checking") {
    body = <p className={styles.muted}>Checking for updates…</p>;
  } else if (state.phase === "downloading") {
    body = (
      <p className={styles.muted}>
        Downloading update {state.updateVersion ?? ""}… {state.progressPercent}%
      </p>
    );
  } else if (state.phase === "error") {
    body = (
      <p className={styles.error}>
        Could not check for updates. {state.error ?? ""}
      </p>
    );
  } else if (
    (state.phase === "available" || state.phase === "downloaded") &&
    state.releaseNotes
  ) {
    body = <Markdown text={state.releaseNotes} className={styles.notes} />;
  } else if (state.phase === "available" || state.phase === "downloaded") {
    body = (
      <p className={styles.muted}>
        Release notes for {state.updateVersion ?? "the new version"} are not
        available offline. See the GitHub release for the full changelog.
      </p>
    );
  } else {
    body = (
      <p className={styles.muted}>
        You&apos;re on the latest version ({state.currentVersion}).
      </p>
    );
  }

  const headerVersion =
    state.phase === "available" || state.phase === "downloaded"
      ? state.updateVersion
      : state.currentVersion;

  return (
    <Dialog
      onClose={closeChangelogDialog}
      size="medium"
      title={headerVersion ? `What's new in ${headerVersion}` : "What's new"}
      titleId="updater-changelog"
    >
      <div className={styles.body}>{body}</div>
      <div className={styles.footer}>
        <Button
          variant="ghost"
          onClick={() => {
            openExternalUrl("https://github.com/DouweBos/Argus/releases").catch(
              () => {},
            );
          }}
        >
          View all releases
        </Button>
        <div className={styles.spacer} />
        {state.phase === "downloaded" ? (
          <Button
            variant="primary"
            onClick={async () => {
              closeChangelogDialog();
              await quitAndInstall();
            }}
          >
            Restart & install
          </Button>
        ) : (
          <Button variant="secondary" onClick={closeChangelogDialog}>
            Close
          </Button>
        )}
      </div>
    </Dialog>
  );
}
