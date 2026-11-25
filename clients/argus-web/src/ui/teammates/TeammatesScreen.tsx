/** `/teammates`: the named agents on the computer, read like a chat inbox — who, what they are on, when. */

import { useCallback } from "react";
import { formatRelative, loadPhase } from "@argus/client-core";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Icons,
  InboxItemRow,
  OverflowMenu,
  Spinner,
  StatusDot,
  TeammateAvatar,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useTeammatesStore } from "../../stores/teammates";
import { useLiveRefresh } from "../useLiveRefresh";
import { INBOX_REFRESH_MS } from "../automations/useInbox";
import { showTeammatePage } from "./teammateNav";
import { teammateLastActivityAt, teammatePreview } from "./teammateRowText";

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
      const lastActivity = teammateLastActivityAt(summary);

      return (
        <InboxItemRow
          actions={
            <OverflowMenu
              items={[
                {
                  label: "Profile",
                  icon: <Icons.PersonIcon size={12} />,
                  onClick: () => showTeammatePage(teammate.id, "profile"),
                },
                // Paused stops its duties and surfaces; talking to it directly still works.
                ...(hasControl
                  ? [
                      {
                        label: teammate.enabled ? "Pause" : "Resume",
                        disabled: !ready,
                        onClick: () =>
                          void setEnabled(teammate.id, !teammate.enabled),
                      },
                    ]
                  : []),
              ]}
              title={`${teammate.name} actions`}
            />
          }
          key={teammate.id}
          leading={
            <TeammateAvatar
              avatar={teammate.avatar}
              color={teammate.color}
              name={teammate.name}
              size={40}
            />
          }
          meta={
            <>
              {lastActivity !== null && formatRelative(lastActivity)}
              {summary.has_unread_report && (
                <StatusDot aria-label="New report" tone="accent" />
              )}
            </>
          }
          subtitle={
            summary.working ? (
              <StatusDot label={teammatePreview(summary)} pulse tone="accent" />
            ) : (
              teammatePreview(summary)
            )
          }
          title={
            <>
              {teammate.name}{" "}
              {!teammate.enabled && (
                <Badge size="tag" tone="neutral">
                  Paused
                </Badge>
              )}
            </>
          }
          onOpen={() => open(teammate.id)}
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
