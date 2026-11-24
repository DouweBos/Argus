/**
 * `/teammates/gallery`: starting teammates. Picking one asks which projects it
 * looks after, then creates it paused, with its soul and duties, and opens it.
 */

import type { RemoteTeammateTemplate } from "@argus/remote-protocol";
import { useEffect, useState } from "react";
import {
  AUTONOMY_LABELS,
  automationProjectOptions,
  describeError,
} from "@argus/client-core";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Spinner,
  TeammateAvatar,
  TeammateTemplateCard,
  TeammateTemplateGrid,
  ToggleList,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { useTeammatesStore } from "../../stores/teammates";

const SERVICE_NAMES: Record<RemoteTeammateTemplate["requires"][number], string> =
  { github: "GitHub", gitlab: "GitLab", linear: "Linear", slack: "Slack" };

function needsOf(template: RemoteTeammateTemplate): string | undefined {
  const names = template.requires.map((r) => SERVICE_NAMES[r]);

  return names.length > 0 ? names.join(" and ") : undefined;
}

function AddTeammateDialog({
  onClose,
  template,
}: {
  onClose: () => void;
  template: RemoteTeammateTemplate;
}) {
  const projects = useProjectsStore((s) => s.projects);
  const [repoRoots, setRepoRoots] = useState(() =>
    projects.map((p) => p.repo_root),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setError(null);
    const teammate = await useTeammatesStore
      .getState()
      .createFromTemplate(template.id, repoRoots);
    setCreating(false);
    if (teammate) {
      appNavigate({
        name: "teammate",
        teammateId: teammate.id,
        page: "chat",
        threadId: null,
      });
    } else {
      setError(useTeammatesStore.getState().error ?? "Couldn't add it.");
      useTeammatesStore.getState().clearError();
    }
  };

  return (
    <Dialog
      title={`Add ${template.name}`}
      titleId="aw-add-teammate"
      onClose={onClose}
    >
      <DialogBody>
        <div className="aw-inline">
          <TeammateAvatar
            avatar={template.avatar}
            color={template.color}
            name={template.name}
            size={40}
          />
          <span className="aw-muted">{template.tagline}</span>
        </div>
        <p className="aw-muted">Projects this teammate looks after.</p>
        <ToggleList
          emptyMessage="This computer has no projects registered."
          options={automationProjectOptions(projects, repoRoots)}
          selection={repoRoots}
          onChange={setRepoRoots}
        />
        {error && <Banner tone="error">{error}</Banner>}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={creating} onClick={() => void create()}>
          {creating ? "Adding" : "Add teammate"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function TeammateGalleryScreen() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const templates = useTeammatesStore((s) => s.templates);
  const [picked, setPicked] = useState<RemoteTeammateTemplate | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void useProjectsStore
      .getState()
      .refreshProjects({ background: true })
      .catch(() => {});
    useTeammatesStore
      .getState()
      .loadTemplates()
      .catch((err: unknown) => setFailed(describeError(err)));
  }, [ready]);

  if (!templates) {
    return failed ? (
      <Banner tone="error">Couldn't load the teammates — {failed}</Banner>
    ) : (
      <div className="aw-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="aw-automations">
      <TeammateTemplateGrid>
        {templates.map((template) => (
          <TeammateTemplateCard
            autonomy={AUTONOMY_LABELS[template.autonomy]}
            avatar={template.avatar}
            color={template.color}
            dutyNames={template.duty_names}
            handle={template.handle}
            key={template.id}
            name={template.name}
            needs={needsOf(template)}
            tagline={template.tagline}
            onPick={hasControl ? () => setPicked(template) : undefined}
          />
        ))}
      </TeammateTemplateGrid>
      {picked && (
        <AddTeammateDialog template={picked} onClose={() => setPicked(null)} />
      )}
    </div>
  );
}
