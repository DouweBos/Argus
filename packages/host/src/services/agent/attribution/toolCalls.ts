/**
 * The files an agent's edit tool call writes, and which lines it wrote there.
 * Every runner's file changes reach the stream as these cards (Codex and ACP
 * patches are translated into `Edit`/`Write`).
 */

export interface AgentEdit {
  filePath: string;
  /** The text of the lines it wrote, trimmed at the end; null when it wrote the whole file. */
  lines: Set<string> | null;
}

export function normalizeLine(line: string): string {
  return line.trimEnd();
}

function textLines(text: string): Set<string> {
  return new Set(text.split("\n").map(normalizeLine));
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function agentEdits(name: string, input: unknown): AgentEdit[] {
  const record = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Edit": {
      const filePath = str(record.file_path);
      if (!filePath) {
        return [];
      }
      const added = record.new_string;

      return [
        {
          filePath,
          lines: typeof added === "string" ? textLines(added) : null,
        },
      ];
    }
    case "MultiEdit": {
      const filePath = str(record.file_path);
      if (!filePath || !Array.isArray(record.edits)) {
        return [];
      }
      const lines = new Set<string>();
      for (const edit of record.edits as { new_string?: unknown }[]) {
        if (typeof edit?.new_string === "string") {
          for (const line of textLines(edit.new_string)) {
            lines.add(line);
          }
        }
      }

      return [{ filePath, lines }];
    }
    case "Write": {
      const filePath = str(record.file_path);

      return filePath ? [{ filePath, lines: null }] : [];
    }
    case "NotebookEdit": {
      // Cells sit inside the notebook's JSON, so its lines never match the source.
      const filePath = str(record.notebook_path);

      return filePath ? [{ filePath, lines: null }] : [];
    }
    default:
      return [];
  }
}
