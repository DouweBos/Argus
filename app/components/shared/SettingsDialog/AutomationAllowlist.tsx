/**
 * What a read-only automation is additionally allowed to do, and what it was
 * refused while trying.
 *
 * The two halves belong together: the list below is where a refusal goes to
 * become a decision, and one click promotes it into the list above. Widening
 * is always the user's move — a run can ask by being refused, never by
 * granting itself anything.
 */

import type { AppSettings, GateLogEntry } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Chip,
  GateLogRow,
  Input,
  SettingsScreenField,
} from "@argus/peacock";
import { formatRelative } from "../../../lib/automations";
import {
  clearGateLog,
  dismissGateLogEntry,
  getAppSettings,
  listGateLog,
  setAppSettings,
} from "../../../lib/ipc";
import styles from "./AutomationAllowlist.module.css";

/** Which settings key an entry belongs in. */
const KEY_FOR = {
  command: "automation_allowed_commands",
  tool: "automation_allowed_tools",
} as const satisfies Record<GateLogEntry["kind"], keyof AppSettings>;

export function AutomationAllowlist() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [entries, setEntries] = useState<GateLogEntry[]>([]);
  const [draft, setDraft] = useState("");

  const refreshLog = useCallback(() => {
    listGateLog().then(setEntries, () => setEntries([]));
  }, []);

  useEffect(() => {
    getAppSettings().then(setSettings, () => setSettings({}));
    refreshLog();
  }, [refreshLog]);

  const commands = settings?.automation_allowed_commands ?? [];
  const tools = settings?.automation_allowed_tools ?? [];

  const save = (patch: Partial<AppSettings>) => {
    const previous = settings ?? {};
    setSettings({ ...previous, ...patch });
    setAppSettings(patch).catch(() => setSettings(previous));
  };

  const addEntry = (kind: GateLogEntry["kind"], value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const key = KEY_FOR[kind];
    const current = (settings?.[key] as string[] | undefined) ?? [];
    if (current.includes(trimmed)) {
      return;
    }
    save({ [key]: [...current, trimmed] });
  };

  const removeEntry = (kind: GateLogEntry["kind"], value: string) => {
    const key = KEY_FOR[kind];
    const current = (settings?.[key] as string[] | undefined) ?? [];
    save({ [key]: current.filter((entry) => entry !== value) });
  };

  const allow = (entry: GateLogEntry) => {
    addEntry(entry.kind, entry.suggested_entry);
    dismissGateLogEntry(entry.id).then(refreshLog, refreshLog);
  };

  const dismiss = (entry: GateLogEntry) => {
    dismissGateLogEntry(entry.id).then(refreshLog, refreshLog);
  };

  return (
    <>
      <SettingsScreenField
        label="Extra commands for read-only runs"
        caption="A read-only automation may only run commands that observe. Add a command, or a prefix like `gh pr list`, to widen that. Projects cannot add to this — it is yours."
      >
        <div className={styles.editor}>
          {commands.length > 0 && (
            <div className={styles.chips}>
              {commands.map((entry) => (
                <Chip
                  key={entry}
                  mono
                  onDismiss={() => removeEntry("command", entry)}
                >
                  {entry}
                </Chip>
              ))}
            </div>
          )}
          <form
            className={styles.add}
            onSubmit={(e) => {
              e.preventDefault();
              addEntry("command", draft);
              setDraft("");
            }}
          >
            <Input
              mono
              disabled={settings === null}
              placeholder="conductor screenshot"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button size="sm" type="submit" variant="secondary">
              Add
            </Button>
          </form>
        </div>
      </SettingsScreenField>

      {tools.length > 0 && (
        <SettingsScreenField
          label="Extra tools for read-only runs"
          caption="Tools promoted from a refusal below."
        >
          <div className={styles.chips}>
            {tools.map((entry) => (
              <Chip
                key={entry}
                mono
                onDismiss={() => removeEntry("tool", entry)}
              >
                {entry}
              </Chip>
            ))}
          </div>
        </SettingsScreenField>
      )}

      <SettingsScreenField
        label="Refused while running"
        caption={
          entries.length === 0
            ? "Nothing has been turned away. Anything a read-only run is refused shows up here to allow or ignore."
            : "A read-only run tried these and was refused. Allow the ones that only read."
        }
      >
        {entries.length > 0 && (
          <div className={styles.log}>
            {entries.map((entry) => (
              <GateLogRow
                key={entry.id}
                automationName={entry.automation_name}
                attempted={entry.command ?? entry.tool_name}
                suggestedEntry={entry.suggested_entry}
                count={entry.count}
                lastSeen={formatRelative(entry.last_seen_at)}
                onAllow={() => allow(entry)}
                onDismiss={() => dismiss(entry)}
              />
            ))}
            <div className={styles.footer}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => clearGateLog().then(refreshLog, refreshLog)}
              >
                Clear all
              </Button>
            </div>
          </div>
        )}
      </SettingsScreenField>
    </>
  );
}
