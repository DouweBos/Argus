/**
 * Onboarding step 3: pick tools. Lands between permissions and preflight so
 * the prereq filter at preflight time only checks the tools the user
 * actually wants. Skipping is fine — every tool can be enabled later from
 * Settings → Tools.
 *
 * Tools are grouped by `ToolGroup` (e.g. "Device") and rendered as a
 * single parent card per group. The parent checkbox toggles every child in
 * the group; expanding the chevron lets the user opt out of individual
 * tools inside the group.
 */

import type { ToolGroup, ToolManifest } from "../../tools/types";
import { useMemo, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { TOOLS } from "../../tools/registry";
import { setToolEnabled, useUserEnabledMany } from "../../tools/store";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./ToolsStep.module.css";

const GROUP_ORDER: ToolGroup[] = ["Device", "Agent", "Git", "Misc"];

const GROUP_COPY: Record<ToolGroup, { description: string; title: string }> = {
  Device: {
    title: "Device",
    description:
      "Stream, inspect, control, and debug iOS Simulators and Android emulators from Argus.",
  },
  Agent: {
    title: "Agent",
    description: "Extra capabilities for the agent runtime.",
  },
  Git: {
    title: "Git",
    description: "Extra Git tooling.",
  },
  Misc: {
    title: "Other",
    description: "Everything else.",
  },
};

export function ToolsStep() {
  const { advance, skipStep } = useOnboarding();

  const groups = useMemo(() => {
    const byGroup = new Map<ToolGroup, ToolManifest[]>();
    for (const tool of TOOLS) {
      if (tool.hidden) {
        continue;
      }
      const list = byGroup.get(tool.group) ?? [];
      list.push(tool);
      byGroup.set(tool.group, list);
    }

    return GROUP_ORDER.flatMap((group) => {
      const list = byGroup.get(group);
      if (!list || list.length === 0) {
        return [];
      }

      return [{ group, tools: list }];
    });
  }, []);

  const handleContinue = () => advance("preflight");

  return (
    <OnboardingLayout
      currentStep="tools"
      title="Pick the tools you'll use"
      subtitle="Argus ships these tools as opt-in features so you can turn off the ones you don't need. Pick what you want now — you can always change this later in Settings → Tools."
      footerLeft={
        <Button variant="ghost" onClick={() => skipStep("tools", "preflight")}>
          Skip for now
        </Button>
      }
      footerRight={<Button onClick={handleContinue}>Continue</Button>}
    >
      <div className={styles.list}>
        {groups.map(({ group, tools }) => (
          <ToolGroupCard key={group} group={group} tools={tools} />
        ))}
      </div>
    </OnboardingLayout>
  );
}

interface ToolGroupCardProps {
  group: ToolGroup;
  tools: ToolManifest[];
}

function ToolGroupCard({ group, tools }: ToolGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const ids = useMemo(() => tools.map((t) => t.id), [tools]);
  const enabledStates = useUserEnabledMany(ids);
  const enabledCount = enabledStates.filter(Boolean).length;
  const allEnabled = enabledCount === tools.length;
  const someEnabled = enabledCount > 0 && !allEnabled;

  const setAll = (on: boolean) => {
    for (const tool of tools) {
      setToolEnabled(tool.id, on);
    }
  };

  const copy = GROUP_COPY[group];
  const aggregatePrereqs = Array.from(
    new Set(tools.flatMap((t) => t.prereqs ?? [])),
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <input
          ref={(el) => {
            if (el) {
              el.indeterminate = someEnabled;
            }
          }}
          type="checkbox"
          className={styles.checkbox}
          checked={allEnabled}
          onChange={(e) => setAll(e.target.checked)}
          aria-label={`Enable all ${copy.title} tools`}
        />
        <button
          type="button"
          className={styles.headerText}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <div className={styles.text}>
            <span className={styles.name}>{copy.title}</span>
            <span className={styles.description}>{copy.description}</span>
            {aggregatePrereqs.length > 0 && (
              <span className={styles.prereqs}>
                Needs: {aggregatePrereqs.join(", ")}
              </span>
            )}
          </div>
          <span className={styles.chevron} aria-hidden>
            {expanded ? (
              <Icons.ChevronDownIcon size={12} />
            ) : (
              <Icons.ChevronRightIcon size={12} />
            )}
          </span>
        </button>
      </div>
      {expanded && (
        <ul className={styles.children}>
          {tools.map((tool, index) => (
            <ToolChildRow
              key={tool.id}
              tool={tool}
              enabled={enabledStates[index]}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ToolChildRowProps {
  enabled: boolean;
  tool: ToolManifest;
}

function ToolChildRow({ tool, enabled }: ToolChildRowProps) {
  const handleChange = (checked: boolean) => {
    setToolEnabled(tool.id, checked);
  };

  return (
    <li>
      <label className={styles.childRow}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={enabled}
          onChange={(e) => handleChange(e.target.checked)}
        />
        <div className={styles.text}>
          <span className={styles.name}>{tool.name}</span>
          <span className={styles.description}>{tool.description}</span>
          {tool.prereqs && tool.prereqs.length > 0 && (
            <span className={styles.prereqs}>
              Needs: {tool.prereqs.join(", ")}
            </span>
          )}
        </div>
      </label>
    </li>
  );
}
