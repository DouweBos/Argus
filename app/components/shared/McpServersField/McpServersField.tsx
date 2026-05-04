import type { McpTool } from "../../../lib/types";
import type { StatusBulbTone } from "@argus/peacock";
import { useState } from "react";
import { Button, Icons, Input, StatusBulb, TextArea } from "@argus/peacock";
import { dialogStyles } from "../Dialog";
import styles from "./McpServersField.module.css";
import { McpTestButton, type McpProbeStatus } from "./McpTestButton";
import { ToolList } from "./ToolList";
import { entryError, newMcpEntryId, type McpEntry } from "./helpers";

function parseEntryConfig(entry: McpEntry): Record<string, unknown> | null {
  if (entryError(entry) !== null) {
    return null;
  }
  try {
    return JSON.parse(entry.json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface McpServersFieldProps {
  emptyLabel?: string;
  entries: McpEntry[];
  onChange: (next: McpEntry[]) => void;
}

const SAMPLE_JSON = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"]
}`;

const TONE_BY_STATUS: Record<McpProbeStatus, StatusBulbTone> = {
  ok: "success",
  fail: "error",
  "needs-auth": "error",
  testing: "pending",
  unknown: "neutral",
};

const LABEL_BY_STATUS: Record<McpProbeStatus, string> = {
  ok: "Connected",
  fail: "Failed",
  "needs-auth": "Requires authentication",
  testing: "Checking…",
  unknown: "Not yet checked",
};

export function McpServersField({
  entries,
  onChange,
  emptyLabel = "No MCP servers configured",
}: McpServersFieldProps) {
  const update = (id: string, patch: Partial<McpEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));
  const add = () =>
    onChange([
      ...entries,
      { id: newMcpEntryId(), name: "", json: SAMPLE_JSON },
    ]);

  if (entries.length === 0) {
    return (
      <div className={dialogStyles.emptyState}>
        <span>{emptyLabel}</span>
        <Button
          leading={<Icons.PlusIcon size={11} />}
          size="sm"
          variant="secondary"
          onClick={add}
        >
          Add server
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          onChange={(patch) => update(entry.id, patch)}
          onRemove={() => remove(entry.id)}
        />
      ))}
      <Button
        leading={<Icons.PlusIcon size={11} />}
        size="sm"
        variant="secondary"
        onClick={add}
      >
        Add server
      </Button>
    </div>
  );
}

interface EntryRowProps {
  entry: McpEntry;
  onChange: (patch: Partial<McpEntry>) => void;
  onRemove: () => void;
}

function EntryRow({ entry, onChange, onRemove }: EntryRowProps) {
  const [status, setStatus] = useState<McpProbeStatus>("unknown");
  const [tools, setTools] = useState<McpTool[] | undefined>(undefined);
  const error = entryError(entry);
  const config = parseEntryConfig(entry);

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.nameWrap}>
          <StatusBulb
            tone={TONE_BY_STATUS[status]}
            pulse={status === "testing"}
            title={LABEL_BY_STATUS[status]}
          />
          <Input
            placeholder="Server name (e.g. filesystem)"
            value={entry.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </span>
        <Button
          aria-label="Remove server"
          leading={<Icons.CloseIcon size={12} />}
          variant="ghost"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      <TextArea
        mono
        placeholder="MCP server JSON config"
        rows={6}
        style={{ resize: "vertical" }}
        value={entry.json}
        onChange={(e) => onChange({ json: e.target.value })}
      />
      {error && <p className={styles.error}>{error}</p>}
      {status === "ok" && tools && tools.length > 0 ? (
        <ToolList tools={tools} />
      ) : null}
      <div className={styles.actions}>
        <McpTestButton
          config={config}
          onStatusChange={setStatus}
          onToolsChange={setTools}
        />
      </div>
    </div>
  );
}
