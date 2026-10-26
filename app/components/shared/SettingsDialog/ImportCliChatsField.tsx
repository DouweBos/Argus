/**
 * Settings → Agents → Import Claude Code chats. Host setting, like the
 * automations switch: the CLI history it reads lives on that machine.
 */

import { useEffect, useState } from "react";
import { Button, SettingsScreenField, Toggle } from "@argus/peacock";
import {
  getAppSettings,
  importCliChats,
  setAppSettings,
} from "../../../lib/ipc";
import styles from "./ImportCliChatsField.module.css";

type ImportState =
  | { imported: number; kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "running" };

function importLabel(state: ImportState): string | null {
  switch (state.kind) {
    case "done":
      return state.imported === 0
        ? "Nothing new to import"
        : `Imported ${state.imported} chat${state.imported === 1 ? "" : "s"}`;
    case "error":
      return state.message;
    default:
      return null;
  }
}

export function ImportCliChatsField() {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<ImportState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (settings) => {
        if (!cancelled) {
          setEnabled(settings.import_cli_chats !== false);
          setLoaded(true);
        }
      },
      () => {
        if (!cancelled) {
          setLoaded(true);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const change = (next: boolean) => {
    setEnabled(next);
    setAppSettings({ import_cli_chats: next }).catch(() => setEnabled(!next));
  };

  const runImport = () => {
    setState({ kind: "running" });
    importCliChats().then(
      ({ imported }) => setState({ kind: "done", imported }),
      (e: unknown) =>
        setState({
          kind: "error",
          message: typeof e === "string" ? e : "Import failed.",
        }),
    );
  };

  const label = importLabel(state);

  return (
    <SettingsScreenField
      label="Import Claude Code chats"
      caption="Show chats you ran with the Claude Code CLI in each project's history, so you can resume them here."
    >
      <div className={styles.row}>
        <Toggle checked={enabled} disabled={!loaded} onChange={change}>
          Import chats from the Claude Code CLI
        </Toggle>
        <Button
          disabled={state.kind === "running"}
          size="sm"
          variant="secondary"
          onClick={runImport}
        >
          {state.kind === "running" ? "Importing…" : "Import now"}
        </Button>
      </div>
      {label && (
        <p
          className={`${styles.status} ${state.kind === "error" ? styles.error : ""}`}
        >
          {label}
        </p>
      )}
    </SettingsScreenField>
  );
}
