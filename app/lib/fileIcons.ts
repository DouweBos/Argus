/** Color for a file extension icon in the tree/tabs. */
export function fileIconColor(ext: string): string {
  switch (ext) {
    case "ts":
    case "tsx":
      return "#3178c6";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "#f0db4f";
    case "rs":
      return "#dea584";
    case "swift":
      return "#f05138";
    case "json":
      return "#b8a050";
    case "css":
    case "scss":
    case "less":
      return "#563d7c";
    case "html":
    case "htm":
      return "#e34c26";
    case "md":
    case "mdx":
      return "#519aba";
    case "py":
      return "#3572a5";
    case "go":
      return "#00add8";
    case "yaml":
    case "yml":
      return "#cb171e";
    case "toml":
      return "#9c4121";
    case "svg":
    case "xml":
      return "#f06529";
    case "sh":
    case "bash":
    case "zsh":
      return "#89e051";
    case "sql":
      return "#e38c00";
    case "rb":
      return "#cc342d";
    case "java":
    case "kt":
      return "#b07219";
    case "c":
    case "h":
      return "#555555";
    case "cpp":
    case "hpp":
      return "#f34b7d";
    default:
      return "#808080";
  }
}

/** Short extension label for icon badge. */
export function fileExtLabel(ext: string): string {
  switch (ext) {
    case "tsx":
      return "TX";
    case "ts":
      return "TS";
    case "jsx":
      return "JX";
    case "js":
    case "mjs":
    case "cjs":
      return "JS";
    case "json":
      return "{}";
    case "css":
      return "CS";
    case "scss":
      return "SC";
    case "html":
    case "htm":
      return "<>";
    case "rs":
      return "RS";
    case "swift":
      return "SW";
    case "md":
    case "mdx":
      return "MD";
    case "py":
      return "PY";
    case "go":
      return "GO";
    case "yaml":
    case "yml":
      return "YM";
    case "toml":
      return "TM";
    case "sh":
    case "bash":
    case "zsh":
      return "SH";
    default:
      return ext.slice(0, 2).toUpperCase() || "··";
  }
}
