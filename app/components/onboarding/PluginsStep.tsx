/**
 * Onboarding step 3: pick plugins. Lands between permissions and preflight so
 * the prereq filter at preflight time only checks the plugins the user
 * actually wants. Skipping is fine — every plugin can be enabled later from
 * Settings → Plugins.
 *
 * Plugins are grouped by `PluginGroup` (e.g. "Device") and rendered as a
 * single parent card per group. The parent checkbox toggles every child in
 * the group; expanding the chevron lets the user opt out of individual
 * plugins inside the group.
 */

import type { PluginGroup, PluginManifest } from "../../plugins/types";
import { useMemo, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import { clearPluginAssets, downloadPluginAssets } from "../../lib/ipc";
import { PLUGINS } from "../../plugins/registry";
import {
  getUserEnabled,
  setPluginEnabled,
  useUserEnabledMany,
} from "../../plugins/store";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./PluginsStep.module.css";

const GROUP_ORDER: PluginGroup[] = ["Device", "Agent", "Git", "Misc"];

const GROUP_COPY: Record<PluginGroup, { description: string; title: string }> =
  {
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

export function PluginsStep() {
  const { advance, skipStep } = useOnboarding();
  const [downloading, setDownloading] = useState(false);

  const groups = useMemo(() => {
    const byGroup = new Map<PluginGroup, PluginManifest[]>();
    for (const plugin of PLUGINS) {
      if (plugin.hidden) {
        continue;
      }
      const list = byGroup.get(plugin.group) ?? [];
      list.push(plugin);
      byGroup.set(plugin.group, list);
    }

    return GROUP_ORDER.flatMap((group) => {
      const list = byGroup.get(group);
      if (!list || list.length === 0) {
        return [];
      }

      return [{ group, plugins: list }];
    });
  }, []);

  const handleContinue = async () => {
    setDownloading(true);
    try {
      const enabled = groups
        .flatMap((g) => g.plugins)
        .filter((p) => getUserEnabled(p.id));
      await Promise.allSettled(enabled.map((p) => downloadPluginAssets(p.id)));
    } finally {
      setDownloading(false);
      await advance("preflight");
    }
  };

  return (
    <OnboardingLayout
      currentStep="plugins"
      title="Pick the tools you'll use"
      subtitle="Argus ships these as opt-in plugins so the install stays small. Turn on what you need now — you can always change this later in Settings → Plugins."
      footerLeft={
        <Button
          variant="ghost"
          onClick={() => skipStep("plugins", "preflight")}
        >
          Skip for now
        </Button>
      }
      footerRight={
        <Button onClick={handleContinue} disabled={downloading}>
          {downloading ? "Downloading…" : "Continue"}
        </Button>
      }
    >
      <div className={styles.list}>
        {groups.map(({ group, plugins }) => (
          <PluginGroupCard key={group} group={group} plugins={plugins} />
        ))}
      </div>
    </OnboardingLayout>
  );
}

interface PluginGroupCardProps {
  group: PluginGroup;
  plugins: PluginManifest[];
}

function PluginGroupCard({ group, plugins }: PluginGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const ids = useMemo(() => plugins.map((p) => p.id), [plugins]);
  const enabledStates = useUserEnabledMany(ids);
  const enabledCount = enabledStates.filter(Boolean).length;
  const allEnabled = enabledCount === plugins.length;
  const someEnabled = enabledCount > 0 && !allEnabled;

  const setAll = (on: boolean) => {
    for (const plugin of plugins) {
      setPluginEnabled(plugin.id, on);
      if (!on) {
        clearPluginAssets(plugin.id).catch(() => {});
      }
    }
  };

  const copy = GROUP_COPY[group];
  const aggregatePrereqs = Array.from(
    new Set(plugins.flatMap((p) => p.prereqs ?? [])),
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
          aria-label={`Enable all ${copy.title} plugins`}
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
          {plugins.map((plugin, index) => (
            <PluginChildRow
              key={plugin.id}
              plugin={plugin}
              enabled={enabledStates[index]}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface PluginChildRowProps {
  enabled: boolean;
  plugin: PluginManifest;
}

function PluginChildRow({ plugin, enabled }: PluginChildRowProps) {
  const handleChange = (checked: boolean) => {
    setPluginEnabled(plugin.id, checked);
    if (!checked) {
      clearPluginAssets(plugin.id).catch(() => {});
    }
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
          <span className={styles.name}>{plugin.name}</span>
          <span className={styles.description}>{plugin.description}</span>
          {plugin.prereqs && plugin.prereqs.length > 0 && (
            <span className={styles.prereqs}>
              Needs: {plugin.prereqs.join(", ")}
            </span>
          )}
        </div>
      </label>
    </li>
  );
}
