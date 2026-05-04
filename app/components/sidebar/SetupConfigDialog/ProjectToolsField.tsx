/**
 * Project-level tool disable list. Renders inside Project Settings → Tools.
 * Checking a tool here writes its id into `.argus.json#tools.disabled` —
 * that masks the tool off for everyone working on this project, regardless
 * of their personal user toggle. Useful for repos that don't use device
 * tooling (e.g. server-only projects).
 *
 * A project cannot force-enable a tool the user has disabled; this is
 * mask-only by design.
 */

import type { ToolId } from "../../../tools/types";
import {
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  Toggle,
} from "@argus/peacock";
import { TOOLS } from "../../../tools/registry";
import styles from "./ProjectToolsField.module.css";

interface ProjectToolsFieldProps {
  disabled: string[];
  onChange: (next: string[]) => void;
}

export function ProjectToolsField({
  disabled,
  onChange,
}: ProjectToolsFieldProps) {
  const visible = TOOLS.filter((t) => !t.hidden);
  const set = new Set(disabled);

  const toggle = (id: ToolId, on: boolean) => {
    const next = new Set(set);
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
    onChange(Array.from(next));
  };

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Disable tools for everyone working on this project. Saved to .argus.json so the mask travels with the repo. Cannot force-enable tools your team members have turned off."
        title="Disabled tools"
      />
      <SettingsScreenDetailBody>
        <div className={styles.list}>
          {visible.map((tool) => {
            const isDisabled = set.has(tool.id);

            return (
              <div key={tool.id} className={styles.row}>
                <div className={styles.text}>
                  <span className={styles.name}>{tool.name}</span>
                  <span className={styles.description}>{tool.description}</span>
                </div>
                <Toggle
                  checked={isDisabled}
                  onChange={(checked) => toggle(tool.id, checked)}
                />
              </div>
            );
          })}
        </div>
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}
