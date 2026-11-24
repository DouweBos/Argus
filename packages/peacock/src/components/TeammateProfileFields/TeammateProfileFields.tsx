import {
  AUTONOMY_CAPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  type AutonomyLevel,
  type TeammateDraft,
  teammateHandleError,
} from "@argus/client-core";
import { Button } from "../Button/Button";
import { FormField } from "../FormField/FormField";
import { Input, TextArea } from "../Input/Input";
import { MenuChip } from "../MenuChip/MenuChip";
import { TeammateAvatar } from "../TeammateAvatar/TeammateAvatar";
import { TeammateLookPicker } from "../TeammateAvatar/TeammateLookPicker";
import { ToggleList, type ToggleListOption } from "../ToggleList/ToggleList";
import styles from "./TeammateProfileFields.module.css";

export interface TeammateProfileFieldsProps {
  draft: TeammateDraft;
  onChange: (draft: TeammateDraft) => void;
  /** The caller adds any the draft names but the computer no longer lists. */
  projects: ToggleListOption[];
  /** "Rewrite with Claude". Omit when this client may not spend. */
  onReviseSoul?: () => void;
  disabled?: boolean;
}

/**
 * Who a teammate is, its soul, what it looks after and how far it may go —
 * the Mac's `TeammateProfileForm`. Saving is the caller's, explicitly.
 */
export function TeammateProfileFields({
  disabled,
  draft,
  onChange,
  onReviseSoul,
  projects,
}: TeammateProfileFieldsProps) {
  const patch = (value: Partial<TeammateDraft>) =>
    onChange({ ...draft, ...value });

  return (
    <div className={styles.fields}>
      <section className={styles.group}>
        <h3 className={styles.heading}>Identity</h3>
        <div className={styles.identity}>
          <TeammateAvatar
            avatar={draft.avatar}
            color={draft.color}
            name={draft.name}
            size={44}
          />
          <div className={styles.names}>
            <FormField label="Name">
              <Input
                disabled={disabled}
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </FormField>
            <FormField
              error={teammateHandleError(draft.handle) ?? undefined}
              label="Handle"
            >
              <Input
                disabled={disabled}
                value={draft.handle}
                onChange={(e) => patch({ handle: e.target.value })}
              />
            </FormField>
          </div>
        </div>
        <FormField label="Tagline">
          <Input
            disabled={disabled}
            value={draft.tagline}
            onChange={(e) => patch({ tagline: e.target.value })}
          />
        </FormField>
        <span className={styles.subLabel}>Colour and symbol</span>
        <TeammateLookPicker
          avatar={draft.avatar}
          color={draft.color}
          disabled={disabled}
          name={draft.name}
          onChange={patch}
        />
      </section>

      <section className={styles.group}>
        <div className={styles.headingRow}>
          <h3 className={styles.heading}>Soul</h3>
          {onReviseSoul && (
            <Button
              disabled={disabled || draft.soul.trim().length === 0}
              size="sm"
              variant="secondary"
              onClick={onReviseSoul}
            >
              Rewrite with Claude
            </Button>
          )}
        </div>
        <p className={styles.caption}>
          Who it is and how it works, in markdown. Every duty and conversation
          starts from it.
        </p>
        <TextArea
          mono
          aria-label="Soul"
          className={styles.soul}
          disabled={disabled}
          rows={12}
          value={draft.soul}
          onChange={(e) => patch({ soul: e.target.value })}
        />
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Projects</h3>
        <p className={styles.caption}>
          Projects it looks after; new duties start here.
        </p>
        <ToggleList
          disabled={disabled}
          emptyMessage="This computer has no projects registered."
          options={projects}
          selection={draft.repoRoots}
          onChange={(repoRoots) => patch({ repoRoots })}
        />
      </section>

      <section className={styles.group}>
        <h3 className={styles.heading}>Autonomy</h3>
        <p className={styles.caption}>
          {draft.autonomy
            ? AUTONOMY_CAPTIONS[draft.autonomy]
            : "A ceiling over every duty and conversation; inheriting takes the computer's default."}
        </p>
        <div>
          <MenuChip
            showsTitle
            disabled={disabled}
            options={[
              {
                value: "",
                label: "Inherit",
                hint: "Use the computer's default",
              },
              ...AUTONOMY_LEVELS.map((level) => ({
                value: level,
                label: AUTONOMY_LABELS[level],
                hint: AUTONOMY_CAPTIONS[level],
              })),
            ]}
            title="Autonomy"
            value={draft.autonomy ?? ""}
            onChange={(value) =>
              patch({ autonomy: (value || null) as AutonomyLevel | null })
            }
          />
        </div>
      </section>
    </div>
  );
}
