/**
 * `/sessions/:id/git/stashes`: the session's stashes and tags. Applying,
 * popping or dropping a stash needs control; tags read only, as on the phone.
 */

import type { GitStashEntry, GitTag } from "@argus/remote-protocol";
import { useCallback, useState } from "react";
import { describeError, relativeTime } from "@argus/client-core";
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  SidebarSection,
  Spinner,
} from "@argus/peacock";
import {
  applyStash,
  dropStash,
  listStashes,
  listTags,
} from "../../stores/branches";
import { useConnectionStore } from "../../stores/connection";
import { useLiveRefresh } from "../useLiveRefresh";

export function StashesScreen({ sessionId }: { sessionId: string }) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const [stashes, setStashes] = useState<GitStashEntry[] | null>(null);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(
    null,
  );
  const [dropping, setDropping] = useState<GitStashEntry | null>(null);

  const refresh = useCallback(() => {
    Promise.all([listStashes(sessionId), listTags(sessionId).catch(() => [])])
      .then(([s, t]) => {
        setStashes(s);
        setTags(t);
      })
      .catch((err: unknown) =>
        setNote({ error: true, text: describeError(err) }),
      );
  }, [sessionId]);
  useLiveRefresh(ready, refresh, 15_000);

  const apply = (index: number, drop: boolean) => {
    setBusy(index);
    setNote(null);
    applyStash(sessionId, index, drop)
      .then((output) =>
        setNote({
          error: false,
          text: output.trim() || (drop ? "Popped." : "Applied."),
        }),
      )
      .catch((err: unknown) => setNote({ error: true, text: describeError(err) }))
      .finally(() => {
        setBusy(null);
        refresh();
      });
  };

  if (stashes === null && !note) {
    return (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Reading stashes…</span>
      </div>
    );
  }

  return (
    <div className="aw-ship">
      {note && (
        <Banner
          tone={note.error ? "error" : "success"}
          onDismiss={() => setNote(null)}
        >
          <span className="aw-ship-output">{note.text}</span>
        </Banner>
      )}

      <SidebarSection count={stashes?.length ?? 0}>Stashes</SidebarSection>
      {stashes?.length === 0 && <span className="aw-muted">Nothing stashed.</span>}
      {stashes?.map((stash) => (
        <Card
          key={stash.hash}
          stack
          className={busy === stash.index ? "aw-ship-busy" : undefined}
        >
          <div className="aw-ship-row">
            <Badge tone="neutral">{`stash@{${stash.index}}`}</Badge>
            <span className="aw-muted">{relativeTime(stash.date)}</span>
          </div>
          <span className="aw-ship-body">{stash.message}</span>
          {hasControl && (
            <div className="aw-ship-actions">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => apply(stash.index, false)}
              >
                Apply
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => apply(stash.index, true)}
              >
                Pop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => setDropping(stash)}
              >
                Drop
              </Button>
            </div>
          )}
        </Card>
      ))}

      <SidebarSection count={tags.length}>Tags</SidebarSection>
      {tags.length === 0 && <span className="aw-muted">No tags.</span>}
      {tags.map((tag) => (
        <Card key={tag.name} stack>
          <div className="aw-ship-row">
            <span className="aw-ship-mono">{tag.name}</span>
            {tag.pushed === false && <Badge tone="neutral">not pushed</Badge>}
          </div>
          <span className="aw-muted">
            {tag.commitHash.slice(0, 7)} {tag.subject}
          </span>
        </Card>
      ))}

      {dropping && (
        <ConfirmDialog
          destructive
          title="Drop this stash?"
          titleId="aw-stash-drop"
          confirmLabel="Drop"
          onCancel={() => setDropping(null)}
          onConfirm={async () => {
            const index = dropping.index;
            setDropping(null);
            setBusy(index);
            try {
              await dropStash(sessionId, index);
              setNote({ error: false, text: `Dropped stash@{${index}}.` });
            } catch (err) {
              setNote({ error: true, text: describeError(err) });
            } finally {
              setBusy(null);
              refresh();
            }
          }}
        >
          The stashed changes are gone for good.
        </ConfirmDialog>
      )}
    </div>
  );
}
