/**
 * Settings → Tools section. Lists every tool grouped by `ToolGroup`,
 * shows the user toggle, surfaces dependency hints when a tool is forced
 * off because a base is disabled, and runs the tool's prereqs live with
 * Fix actions inline. Same `PrereqList` component the onboarding Preflight
 * step uses, so a missing checks Settings flow stays in sync.
 */

import type { ToolGroup, ToolManifest } from "../../../tools/types";
import { useMemo } from "react";
import {
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  Toggle,
} from "@argus/peacock";
import { TOOLS } from "../../../tools/registry";
import {
  setToolEnabled,
  useEffectiveToolEnabled,
  useToolEnabled,
  useProjectDisabled,
} from "../../../tools/store";
import { PrereqList } from "../PrereqList";
import { ConductorVersionField } from "./ConductorVersionField";
import styles from "./ToolsSection.module.css";

const GROUP_ORDER: ToolGroup[] = ["Device", "Agent", "Git", "Misc"];

export function ToolsSection() {
  const groups = useMemo(() => {
    const byGroup = new Map<ToolGroup, ToolManifest[]>();
    for (const tool of TOOLS) {
      if (tool.hidden) {
        continue;
      }
      const existing = byGroup.get(tool.group) ?? [];
      existing.push(tool);
      byGroup.set(tool.group, existing);
    }

    return GROUP_ORDER.flatMap((group) => {
      const list = byGroup.get(group);
      if (!list || list.length === 0) {
        return [];
      }

      return [{ group, tools: list }];
    });
  }, []);

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Turn off the tools you don't use to keep Argus's UI focused."
        title="Tools"
      />
      <SettingsScreenDetailBody>
        {groups.map(({ group, tools }) => (
          <SettingsScreenField key={group} label={group}>
            <div className={styles.list}>
              {tools.map((tool) => (
                <ToolRow key={tool.id} tool={tool} />
              ))}
            </div>
          </SettingsScreenField>
        ))}
        <ConductorVersionField />
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

interface ToolRowProps {
  tool: ToolManifest;
}

function ToolRow({ tool }: ToolRowProps) {
  const userEnabled = useToolEnabled(tool.id);
  const effective = useEffectiveToolEnabled(tool.id);
  const projectDisabled = useProjectDisabled();

  const handleToggle = (checked: boolean) => {
    setToolEnabled(tool.id, checked);
  };

  const projectMasked = projectDisabled.includes(tool.id);
  const blockedByDep = userEnabled && !effective && !projectMasked;
  const missingDeps = blockedByDep
    ? (tool.requires ?? []).filter(
        (dep) => !TOOLS.find((t) => t.id === dep)?.defaultEnabled,
      )
    : [];

  const status = (() => {
    if (projectMasked) {
      return "Disabled by this project";
    }
    if (blockedByDep && missingDeps.length > 0) {
      return `Needs: ${missingDeps.join(", ")}`;
    }

    return null;
  })();

  // Render the live prereq list once the tool has been turned on. Hidden
  // when the toggle is off — there's no point running checks for tooling
  // the user doesn't need.
  const showPrereqs =
    userEnabled && !projectMasked && tool.prereqs && tool.prereqs.length > 0;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <div className={styles.text}>
          <span className={styles.name}>{tool.name}</span>
          <span className={styles.description}>{tool.description}</span>
          {status && <span className={styles.status}>{status}</span>}
        </div>
        <Toggle
          checked={userEnabled}
          disabled={projectMasked}
          onChange={handleToggle}
        />
      </div>
      {showPrereqs && (
        <div className={styles.prereqs}>
          <PrereqList ids={tool.prereqs ?? []} />
        </div>
      )}
    </div>
  );
}
