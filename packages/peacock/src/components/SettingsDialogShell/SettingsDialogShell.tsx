import { useState, type ReactNode } from "react";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import {
  SettingsScreen,
  SettingsScreenSection,
  SettingsScreenSectionGroup,
  SettingsScreenSidebar,
} from "../SettingsScreen/SettingsScreen";
import styles from "./SettingsDialogShell.module.css";

export interface SettingsDialogSection {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Body of the detail pane when this section is active. */
  render: () => ReactNode;
}

export interface SettingsDialogGroup {
  /** Optional uppercase header above the group's sections. */
  label?: ReactNode;
  sections: SettingsDialogSection[];
}

export interface SettingsDialogShellProps {
  /** Optional className merged onto the dialog. */
  className?: string;
  /** Footer slot rendered below the screen — typically a save/cancel bar. */
  footer?: ReactNode;
  groups: SettingsDialogGroup[];
  /** Section id to show first. Defaults to the first section in the first group. */
  initialSectionId?: string;
  onClose: () => void;
  title: string;
  titleId: string;
}

/**
 * iPad-style settings dialog: a full-size modal that hosts a `SettingsScreen`
 * (left section list + right detail pane) plus an optional footer slot.
 *
 * Pass a `groups` array — each group is a labelled cluster of sections, and
 * each section owns a `render()` for its body. The shell handles the
 * active-section state internally.
 *
 * Use this for any settings UI (app-level, project-level, per-feature) so
 * layout, sidebar, and section switching stay consistent without duplicated
 * scaffolding.
 */
export function SettingsDialogShell({
  className,
  footer,
  groups,
  initialSectionId,
  onClose,
  title,
  titleId,
}: SettingsDialogShellProps) {
  const allSections = groups.flatMap((g) => g.sections);
  const fallbackId = allSections[0]?.id ?? "";
  const [activeId, setActiveId] = useState(initialSectionId ?? fallbackId);
  const active =
    allSections.find((s) => s.id === activeId) ?? allSections[0] ?? null;

  return (
    <Dialog
      className={[styles.dialog, className].filter(Boolean).join(" ")}
      size="full"
      title={title}
      titleId={titleId}
      onClose={onClose}
    >
      <DialogBody flush>
        <SettingsScreen className={styles.screen}>
          <SettingsScreenSidebar>
            {groups.map((g, i) => (
              <SettingsScreenSectionGroup key={i} label={g.label}>
                {g.sections.map((s) => (
                  <SettingsScreenSection
                    key={s.id}
                    active={activeId === s.id}
                    description={s.description}
                    icon={s.icon}
                    onClick={() => setActiveId(s.id)}
                  >
                    {s.label}
                  </SettingsScreenSection>
                ))}
              </SettingsScreenSectionGroup>
            ))}
          </SettingsScreenSidebar>

          {active?.render()}
        </SettingsScreen>
      </DialogBody>

      {footer}
    </Dialog>
  );
}
