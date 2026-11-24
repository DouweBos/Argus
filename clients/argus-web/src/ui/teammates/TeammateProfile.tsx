/**
 * `/teammates/:id/profile`: who it is, its soul, what it looks after and how
 * far it may go. Saving is explicit; deleting asks what becomes of its duties.
 */

import { useEffect, useState } from "react";
import {
  automationProjectOptions,
  describeError,
  type TeammateDraft,
  teammateCanSave,
  teammateDraft,
  teammateDraftChanged,
  teammatePatch,
} from "@argus/client-core";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  RevisePlaybookDialog,
  Spinner,
  TeammatePageBar,
  TeammateProfileFields,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { useTeammatesStore } from "../../stores/teammates";
import { showTeammatePage } from "./teammateNav";

function DeleteTeammateDialog({
  onCancel,
  onDelete,
}: {
  onCancel: () => void;
  onDelete: (keepDuties: boolean) => void;
}) {
  return (
    <Dialog
      title="Delete this teammate?"
      titleId="aw-delete-teammate"
      onClose={onCancel}
    >
      <DialogBody>
        <p className="aw-muted">
          Its conversations and memory go with it. Kept automations stay
          paused, on their own.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => onDelete(true)}>
          Delete and keep its automations
        </Button>
        <Button variant="danger" onClick={() => onDelete(false)}>
          Delete with its automations
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function TeammateProfile({ teammateId }: { teammateId: string }) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const projects = useProjectsStore((s) => s.projects);
  const store = useTeammatesStore.getState;
  const [draft, setDraft] = useState<TeammateDraft | null>(null);
  const [saved, setSaved] = useState<TeammateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [revising, setRevising] = useState(false);

  useEffect(() => {
    if (!ready) {
      return;
    }
    store()
      .loadDetail(teammateId)
      .then((detail) => {
        if (detail) {
          const loaded = teammateDraft(detail.teammate, detail.soul);
          setDraft((d) => d ?? loaded);
          setSaved((d) => d ?? loaded);
        }
      })
      .catch((err: unknown) => setError(describeError(err)));
    if (useProjectsStore.getState().projects.length === 0) {
      void useProjectsStore
        .getState()
        .refreshProjects({ background: true })
        .catch(() => {});
    }
  }, [ready, teammateId, store]);

  const dirty = Boolean(draft && saved && teammateDraftChanged(draft, saved));

  const save = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { clear, patch } = teammatePatch(draft);
      await store().update(teammateId, patch, clear);
      if (draft.soul !== saved?.soul) {
        await store().saveSoul(teammateId, draft.soul);
      }
      setSaved(draft);
    } catch (err) {
      setError(`Couldn't save it — ${describeError(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (keepDuties: boolean) => {
    setConfirmingDelete(false);
    if (await store().remove(teammateId, keepDuties)) {
      appNavigate({ name: "teammates" }, { replace: true });
    } else {
      setError(store().error);
      store().clearError();
    }
  };

  let saveLabel = "Saved";
  if (saving) {
    saveLabel = "Saving";
  } else if (dirty) {
    saveLabel = "Save";
  }

  return (
    <div className="aw-automations">
      <TeammatePageBar
        actions={
          hasControl &&
          draft && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
              <Button
                disabled={saving || !dirty || !teammateCanSave(draft)}
                size="sm"
                onClick={() => void save()}
              >
                {saveLabel}
              </Button>
            </>
          )
        }
        page="profile"
        onPage={(page) => showTeammatePage(teammateId, page)}
      />
      {error && (
        <Banner tone="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {draft ? (
        <TeammateProfileFields
          disabled={!hasControl}
          draft={draft}
          projects={automationProjectOptions(projects, draft.repoRoots)}
          onChange={setDraft}
          onReviseSoul={hasControl ? () => setRevising(true) : undefined}
        />
      ) : (
        <div className="aw-center">
          <Spinner />
        </div>
      )}
      {revising && draft && (
        <RevisePlaybookDialog
          subject="soul"
          onApply={(soul) => setDraft({ ...draft, soul })}
          onClose={() => setRevising(false)}
          onRevise={(instruction) =>
            store().reviseSoul(draft.name, draft.soul, instruction)
          }
        />
      )}
      {confirmingDelete && (
        <DeleteTeammateDialog
          onCancel={() => setConfirmingDelete(false)}
          onDelete={(keep) => void remove(keep)}
        />
      )}
    </div>
  );
}
