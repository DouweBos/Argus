import type { ProjectEntry } from "../../../lib/types";
import type { ModelOption } from "../ModelPicker";
import { useEffect, useRef, useState } from "react";
import { Chip, Icons } from "@argus/peacock";
import { listProjects } from "../../../lib/ipc";
import {
  type CanonicalPermissionMode,
  permissionModeDisplayName,
} from "../../../lib/permissionModes";
import { ModelPicker, type RunnerSelection } from "../ModelPicker";
import { PermissionModePicker } from "../PermissionModePicker";
import { ProjectPicker } from "../ProjectPicker";
import styles from "./StartComposer.module.css";

interface AgentOptionChipsProps {
  linkedProjects: string[];
  model: string;
  models: ModelOption[];
  onModelChange: (model: string) => void;
  onPermissionModeChange: (mode: CanonicalPermissionMode) => void;
  onToggleLinkedProject: (path: string) => void;
  permissionMode: CanonicalPermissionMode;
  runner: RunnerSelection;
}

type OpenPicker = "mode" | "model" | "projects" | null;

/** Permission mode, model and linked projects for the agent about to start. */
export function AgentOptionChips({
  linkedProjects,
  model,
  models,
  onModelChange,
  onPermissionModeChange,
  onToggleLinkedProject,
  permissionMode,
  runner,
}: AgentOptionChipsProps) {
  const [open, setOpen] = useState<OpenPicker>(null);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const modeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const toggle = (which: OpenPicker) =>
    setOpen((current) => (current === which ? null : which));
  const close = () => setOpen(null);

  useEffect(() => {
    if (open !== "projects") {
      return;
    }
    let cancelled = false;
    listProjects()
      .then((result) => !cancelled && setProjects(result))
      .catch(() => !cancelled && setProjects([]));

    return () => {
      cancelled = true;
    };
  }, [open]);

  const modelName =
    models.find((m) => m.value === model)?.displayName ??
    models[0]?.displayName;

  return (
    <>
      <div ref={modeRef} className={styles.chipAnchor}>
        <Chip
          interactive
          muted={permissionMode === "auto"}
          aria-label="Switch permission mode"
          title={`Permission mode: ${permissionModeDisplayName(permissionMode)}`}
          onClick={() => toggle("mode")}
        >
          {permissionModeDisplayName(permissionMode)}
        </Chip>
        {open === "mode" && (
          <PermissionModePicker
            triggerRef={modeRef}
            currentMode={permissionMode}
            onClose={close}
            onSelect={(m) => {
              close();
              onPermissionModeChange(m);
            }}
          />
        )}
      </div>
      {models.length > 0 && modelName && (
        <div ref={modelRef} className={styles.chipAnchor}>
          <Chip
            mono
            muted
            interactive
            title="Switch model"
            onClick={() => toggle("model")}
          >
            {modelName}
          </Chip>
          {open === "model" && (
            <ModelPicker
              triggerRef={modelRef}
              currentModel={model}
              models={models}
              runner={runner}
              onClose={close}
              onSelect={(m) => {
                close();
                onModelChange(m);
              }}
            />
          )}
        </div>
      )}
      <div ref={projectsRef} className={styles.chipAnchor}>
        <Chip
          interactive
          muted={linkedProjects.length === 0}
          aria-label="Link other project"
          title={
            linkedProjects.length === 0
              ? "Link other project"
              : `${linkedProjects.length} project${linkedProjects.length === 1 ? "" : "s"} linked`
          }
          leading={<Icons.FolderIcon size={11} />}
          onClick={() => toggle("projects")}
        >
          {linkedProjects.length === 0
            ? "Link project"
            : `${linkedProjects.length} linked`}
        </Chip>
        {open === "projects" && (
          <ProjectPicker
            triggerRef={projectsRef}
            projects={projects}
            selectedPaths={linkedProjects}
            onToggle={onToggleLinkedProject}
            onClose={close}
          />
        )}
      </div>
    </>
  );
}
