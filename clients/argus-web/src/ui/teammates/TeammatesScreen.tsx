/** `/teammates`: the named agents on the computer — who, their duties, when they last did something, their switch. */

import { useCallback } from "react";
import { formatRelative, loadPhase } from "@argus/client-core";
import {
  Banner,
  Button,
  EmptyState,
  Icons,
  Spinner,
  TeammateRow,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useTeammatesStore } from "../../stores/teammates";
import { useLiveRefresh } from "../useLiveRefresh";
import { INBOX_REFRESH_MS } from "../automations/useInbox";

/** The list, polled like the automations list: duties run without telling the browser. */
export function useTeammatesRefresh(ready: boolean): void {
  const poll = useCallback(
    () =>
      void useTeammatesStore
        .getState()
        .refresh({ background: true })
        .catch(() => {}),
    [],
  );
  useLiveRefresh(ready, poll, INBOX_REFRESH_MS);
}

export function TeammatesScreen() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const summaries = useTeammatesStore((s) => s.summaries);
  const load = useTeammatesStore((s) => s.load);
  const error = useTeammatesStore((s) => s.error);
  const { clearError, refresh, setEnabled } = useTeammatesStore.getState();
  useTeammatesRefresh(ready);

  const phase = loadPhase(load, summaries.length === 0);
  const browse = () => appNavigate({ name: "teammateGallery" });
  const open = (teammateId: string) =>
    appNavigate({ name: "teammate", teammateId, page: "chat", threadId: null });

  let body;
  if (phase.kind === "loading") {
    body = (
      <div className="aw-center">
        <Spinner />
      </div>
    );
  } else if (phase.kind === "failed") {
    body = (
      <EmptyState
        action={
          <Button size="sm" onClick={() => void refresh().catch(() => {})}>
            Try again
          </Button>
        }
        body={phase.error}
        icon={<Icons.PersonIcon size={18} />}
        title="Teammates unavailable"
      />
    );
  } else if (phase.kind === "empty") {
    body = (
      <EmptyState
        action={
          hasControl && (
            <Button size="sm" onClick={browse}>
              Browse teammates
            </Button>
          )
        }
        body="A teammate is an agent with a name, a memory and duties of its own. It runs its duties on their triggers, and you can talk to it whenever you like."
        icon={<Icons.PersonIcon size={18} />}
        title="No teammates yet"
      />
    );
  } else {
    body = summaries.map((summary) => {
      const { teammate } = summary;

      return (
        <TeammateRow
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => open(teammate.id)}
            >
              Talk
            </Button>
          }
          avatar={teammate.avatar}
          color={teammate.color}
          dutyCount={summary.duty_count}
          enableDisabled={!hasControl}
          enabled={teammate.enabled}
          handle={teammate.handle}
          key={teammate.id}
          lastRunLabel={
            summary.last_run_at ? formatRelative(summary.last_run_at) : "Never"
          }
          name={teammate.name}
          tagline={teammate.tagline}
          unread={summary.has_unread_report}
          onOpen={() => open(teammate.id)}
          onToggleEnabled={(enabled) => void setEnabled(teammate.id, enabled)}
        />
      );
    });
  }

  return (
    <div className="aw-automations">
      {error && (
        <Banner tone="error" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      {hasControl && phase.kind === "content" && (
        <div>
          <Button
            leading={<Icons.PlusIcon size={11} />}
            size="sm"
            onClick={browse}
          >
            New teammate
          </Button>
        </div>
      )}
      {body}
    </div>
  );
}
