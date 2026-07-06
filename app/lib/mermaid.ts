import type { Mermaid } from "mermaid";
import { getResolvedTheme, type ResolvedTheme } from "../stores/themeStore";

let modulePromise: Promise<Mermaid> | null = null;
// Theme the singleton is currently initialized for; re-init when it drifts.
let initializedTheme: ResolvedTheme | null = null;
// Serializes parse/render calls — mermaid keeps a single global parser, so
// overlapping operations corrupt each other's state.
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work);
  chain = run.catch(() => undefined);

  return run;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

// Map Argus tokens onto mermaid's "base" theme so diagrams match the app.
function themeVariables(theme: ResolvedTheme): Record<string, string> {
  return {
    darkMode: theme === "dark" ? "true" : "false",
    fontFamily: cssVar("--font-ui"),
    background: cssVar("--bg-secondary"),
    primaryColor: cssVar("--surface-3-solid"),
    primaryTextColor: cssVar("--text-primary"),
    primaryBorderColor: cssVar("--border-strong"),
    secondaryColor: cssVar("--surface-4-solid"),
    tertiaryColor: cssVar("--bg-primary"),
    lineColor: cssVar("--text-muted"),
    textColor: cssVar("--text-primary"),
    mainBkg: cssVar("--surface-3-solid"),
    nodeBorder: cssVar("--border-strong"),
    clusterBkg: cssVar("--bg-primary"),
    clusterBorder: cssVar("--border-strong"),
    noteBkgColor: cssVar("--surface-4-solid"),
    noteTextColor: cssVar("--text-primary"),
    noteBorderColor: cssVar("--border-strong"),
    titleColor: cssVar("--text-primary"),
    edgeLabelBackground: cssVar("--bg-secondary"),
  };
}

async function load(): Promise<Mermaid> {
  if (!modulePromise) {
    modulePromise = import("mermaid").then((m) => m.default);
  }

  return modulePromise;
}

async function ensureInitialized(): Promise<Mermaid> {
  const mermaid = await load();
  const theme = getResolvedTheme();
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: themeVariables(theme),
    });
    initializedTheme = theme;
  }

  return mermaid;
}

/** Force re-initialization on the next render (e.g. after a theme switch). */
export function invalidateMermaidTheme(): void {
  initializedTheme = null;
}

/** True when `code` is a complete, parseable diagram (false while streaming). */
export function parseMermaid(code: string): Promise<boolean> {
  return serialize(async () => {
    const mermaid = await ensureInitialized();
    const result = await mermaid.parse(code, { suppressErrors: true });

    return result !== false;
  });
}

/** Render `code` to an SVG string. Rejects if the diagram is invalid. */
export function renderMermaid(id: string, code: string): Promise<string> {
  return serialize(async () => {
    const mermaid = await ensureInitialized();
    const { svg } = await mermaid.render(id, code);

    return svg;
  });
}
