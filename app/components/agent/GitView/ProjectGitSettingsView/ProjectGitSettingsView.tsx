/**
 * Project-scoped git settings — branch prefix, archived branches list,
 * auto-fetch interval, and LFS banner suppression. Lives in-panel (vs. the
 * global Settings dialog) so per-project tweaks stay close to the project the
 * user is looking at.
 */
import type { ArgusConfig, UserProjectSettings } from "../../../../lib/types";
import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  Icons,
  Input,
  SegmentedControl,
  SettingsScreenField,
  Spinner,
  Toggle,
} from "@argus/peacock";
import {
  getUserProjectSettings,
  gitReconfigureAutoFetch,
  gitUnarchiveBranch,
  readArgusConfig,
  setUserProjectSettings,
  writeArgusConfig,
} from "../../../../lib/ipc";
import styles from "./ProjectGitSettingsView.module.css";

interface Props {
  repoRoot: string;
}

type AutoFetchOption = "0" | "5" | "15" | "60";

const AUTO_FETCH_OPTIONS: { label: string; value: AutoFetchOption }[] = [
  { label: "Off", value: "0" },
  { label: "5 min", value: "5" },
  { label: "15 min", value: "15" },
  { label: "60 min", value: "60" },
];

function minutesToOption(minutes: number | null | undefined): AutoFetchOption {
  if (!minutes || minutes <= 0) {
    return "0";
  }
  if (minutes <= 5) {
    return "5";
  }
  if (minutes <= 15) {
    return "15";
  }

  return "60";
}

export function ProjectGitSettingsView({ repoRoot }: Props) {
  const [settings, setSettings] = useState<UserProjectSettings | null>(null);
  const [argusConfig, setArgusConfig] = useState<ArgusConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefixDraft, setPrefixDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingAutoFetch, setSavingAutoFetch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getUserProjectSettings(repoRoot), readArgusConfig(repoRoot)])
      .then(([s, cfg]) => {
        if (!cancelled) {
          setSettings(s);
          setArgusConfig(cfg);
          setPrefixDraft(s.branch_prefix ?? "");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  const savePrefix = async () => {
    setSaving(true);
    try {
      const next = await setUserProjectSettings(repoRoot, {
        branch_prefix: prefixDraft,
      });
      setSettings(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const unarchive = async (branch: string) => {
    try {
      const next = await gitUnarchiveBranch(repoRoot, branch);
      setSettings((s) => (s ? { ...s, archived_branches: next } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveAutoFetch = async (option: AutoFetchOption) => {
    if (!argusConfig) {
      return;
    }
    setSavingAutoFetch(true);
    try {
      const minutes = option === "0" ? null : parseInt(option, 10);
      const next: ArgusConfig = {
        ...argusConfig,
        auto_fetch_minutes: minutes ?? undefined,
      };
      await writeArgusConfig(repoRoot, JSON.stringify(next, null, 2));
      setArgusConfig(next);
      await gitReconfigureAutoFetch(repoRoot, minutes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAutoFetch(false);
    }
  };

  const saveSuppressLfs = async (checked: boolean) => {
    try {
      const next = await setUserProjectSettings(repoRoot, {
        suppress_lfs_warning: checked,
      });
      setSettings(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error && !settings) {
    return (
      <div className={styles.container}>
        <EmptyState
          icon={<Icons.WarningIcon size={20} />}
          title="Couldn't load settings"
          body={error}
        />
      </div>
    );
  }

  if (!settings || !argusConfig) {
    return (
      <div className={styles.container}>
        <EmptyState icon={<Spinner size="md" />} title="Loading…" body="" />
      </div>
    );
  }

  const archived = settings.archived_branches ?? [];
  const prefixDirty = prefixDraft !== (settings.branch_prefix ?? "");
  const currentAutoFetch = minutesToOption(argusConfig.auto_fetch_minutes);

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Git Settings</h2>
      <p className={styles.intro}>
        Personal preferences for this project. Stored at{" "}
        <code>~/.argus/user-project-settings.json</code> — never written into
        the repo.
      </p>

      <SettingsScreenField
        label="Branch prefix"
        caption='Prepended to branches you create through Argus (e.g. "douwe/").'
      >
        <div className={styles.prefixRow}>
          <Input
            value={prefixDraft}
            placeholder="e.g. douwe/"
            onChange={(e) => setPrefixDraft(e.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!prefixDirty || saving}
            onClick={savePrefix}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </SettingsScreenField>

      <SettingsScreenField
        label="Auto-fetch"
        caption="Automatically run git fetch --prune in the background. Written to .argus.json and shared with the team."
      >
        <SegmentedControl
          aria-label="Auto-fetch interval"
          options={AUTO_FETCH_OPTIONS}
          value={currentAutoFetch}
          onChange={(v) => {
            if (!savingAutoFetch) {
              saveAutoFetch(v as AutoFetchOption).catch(() => undefined);
            }
          }}
        />
      </SettingsScreenField>

      <SettingsScreenField
        label="Suppress LFS banners"
        caption="Hide the git-lfs install prompt and LFS-tracked-files banner for this project. Personal preference; not written into the repo."
      >
        <Toggle
          checked={settings.suppress_lfs_warning === true}
          onChange={saveSuppressLfs}
        />
      </SettingsScreenField>

      <SettingsScreenField
        label="Archived branches"
        caption="Branches hidden from the sidebar Branches list. Git is untouched."
      >
        {archived.length === 0 ? (
          <span className={styles.empty}>None archived.</span>
        ) : (
          <ul className={styles.archivedList}>
            {archived.map((b) => (
              <li key={b} className={styles.archivedItem}>
                <span className={styles.archivedName}>{b}</span>
                <Button variant="ghost" size="sm" onClick={() => unarchive(b)}>
                  Unarchive
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsScreenField>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
