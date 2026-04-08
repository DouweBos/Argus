/**
 * Generate a Claude CLI-style rule specifier for the "Always Allow" button.
 *
 * Examples:
 *   Bash(npm *)     — allow all `npm` subcommands
 *   Edit(**\/*.tsx)   — allow edits to all .tsx files
 *   WebFetch(domain:example.com)
 *   Grep            — allow all Grep calls (no meaningful specifier)
 */
export function alwaysAllowRule(
  name: string,
  input: Record<string, unknown>,
): string {
  switch (name) {
    case "Bash": {
      const cmd = ((input.command ?? "") as string).trim();
      const binary = cmd.split(/\s+/)[0] ?? "";
      return binary ? `${name}(${binary} *)` : name;
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read": {
      const filePath = (input.file_path ?? input.path ?? "") as string;
      const ext = filePath.split(".").pop();
      if (ext && ext !== filePath && !ext.includes("/")) {
        return `${name}(**/*.${ext})`;
      }
      return name;
    }
    case "WebFetch": {
      const url = (input.url ?? "") as string;
      try {
        const domain = new URL(url).hostname;
        return domain ? `${name}(domain:${domain})` : name;
      } catch {
        return name;
      }
    }
    default:
      return name;
  }
}
