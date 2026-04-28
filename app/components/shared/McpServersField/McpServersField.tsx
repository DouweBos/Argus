import { Button, Icons, Input, TextArea } from "@argus/peacock";
import { dialogStyles } from "../Dialog";
import styles from "./McpServersField.module.css";
import { entryError, newMcpEntryId, type McpEntry } from "./helpers";

interface McpServersFieldProps {
  emptyLabel?: string;
  entries: McpEntry[];
  onChange: (next: McpEntry[]) => void;
}

const SAMPLE_JSON = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"]
}`;

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
        <button className={dialogStyles.addRowBtn} onClick={add}>
          + Add server
        </button>
      </div>
    );
  }

  return (
    <div className={dialogStyles.listEditor}>
      {entries.map((entry, i) => {
        const error = entryError(entry);

        return (
          <div key={entry.id} className={styles.row}>
            <div className={styles.head}>
              <Input
                placeholder="Server name (e.g. filesystem)"
                style={{ flex: 1 }}
                value={entry.name}
                onChange={(e) => update(entry.id, { name: e.target.value })}
              />
              <Button
                aria-label="Remove server"
                leading={<Icons.CloseIcon size={12} />}
                variant="ghost"
                onClick={() => remove(entry.id)}
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
              onChange={(e) => update(entry.id, { json: e.target.value })}
            />
            {error && <p className={styles.error}>{error}</p>}
            {i < entries.length - 1 && <hr className={styles.divider} />}
          </div>
        );
      })}
      <button className={dialogStyles.addRowBtn} onClick={add}>
        + Add server
      </button>
    </div>
  );
}
