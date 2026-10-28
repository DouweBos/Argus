import type { LinearTeam } from "../../../lib/types";
import { useEffect, useId, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FormField,
  Input,
  Select,
  TextArea,
} from "@argus/peacock";
import {
  fileLinearIssue,
  listLinearTeams,
  openExternalUrl,
} from "../../../lib/ipc";
import { openStartDraft } from "../../../stores/startDraftStore";
import styles from "./FileIssueDialog.module.css";

interface FileIssueDialogProps {
  /** Device name and OS, put under the description. */
  deviceLabel: string;
  onClose: () => void;
  /** The project an agent starts in when filing with "File & start agent". */
  repoRoot: string | null;
  /** Base64 PNG of the device when the dialog opened. */
  screenshot: string | null;
}

/** File what's on the simulator as a Linear bug — and optionally hand it straight to an agent. */
export function FileIssueDialog({
  deviceLabel,
  onClose,
  repoRoot,
  screenshot,
}: FileIssueDialogProps) {
  const titleId = useId();
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listLinearTeams().then(
      (found) => {
        if (!cancelled) {
          setTeams(found);
          setTeamId((current) => current || (found[0]?.id ?? ""));
        }
      },
      (err: unknown) => !cancelled && setError(String(err)),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const file = async (startAgent: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const issue = await fileLinearIssue({
        teamId,
        title,
        description: [
          description.trim(),
          `_Filed from ${deviceLabel} in Argus._`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        screenshot,
      });
      onClose();
      if (startAgent && repoRoot) {
        await openStartDraft(repoRoot, {
          issueRefs: [issue.identifier],
          workspace: "worktree",
        });
      } else {
        openExternalUrl(issue.url).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const canFile = !!teamId && title.trim().length > 0 && !busy;

  return (
    <Dialog
      size="medium"
      title="File in Linear"
      titleId={titleId}
      onClose={onClose}
    >
      <DialogBody>
        <div className={styles.form}>
          {screenshot && (
            <img
              alt="Device screenshot"
              className={styles.shot}
              src={`data:image/png;base64,${screenshot}`}
            />
          )}
          <div className={styles.fields}>
            <FormField label="Team" htmlFor={`${titleId}-team`}>
              <Select
                id={`${titleId}-team`}
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.key})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Title" htmlFor={`${titleId}-title`}>
              <Input
                autoFocus
                id={`${titleId}-title`}
                placeholder="What's wrong?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </FormField>
            <FormField
              label="Description"
              htmlFor={`${titleId}-description`}
              helper={`The screenshot and "${deviceLabel}" are added for you.`}
            >
              <TextArea
                id={`${titleId}-description`}
                rows={5}
                placeholder="Steps, expected and actual behaviour"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
            {error && <p className={styles.error}>{error}</p>}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {repoRoot && (
          <Button disabled={!canFile} onClick={() => file(true)}>
            File & start agent
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!canFile}
          onClick={() => file(false)}
        >
          {busy ? "Filing…" : "File"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
