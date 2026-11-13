import type { Meta, StoryObj } from "@storybook/react";
import type { CSSProperties, ReactNode } from "react";
import { COLOR_THEME_IDS } from "../lib/colorThemes";

const meta: Meta = {
  title: "Foundations/Tokens",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj;

const row: CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };
const card: CSSProperties = {
  padding: 12,
  background: "var(--glass-bg)",
  border: "1px solid var(--glass-border)",
  borderRadius: 12,
  minWidth: 160,
};
const swatch = (bg: string): CSSProperties => ({
  width: 48,
  height: 48,
  borderRadius: 8,
  border: "1px solid var(--glass-border)",
  background: bg,
});

function Token({
  name,
  value,
  preview,
}: {
  name: string;
  value: string;
  preview: ReactNode;
}) {
  return (
    <div style={card}>
      {preview}
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "var(--text-primary)",
          fontWeight: 500,
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-muted)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export const Colors: Story = {
  render: () => (
    <div
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}
    >
      <section>
        <h3 className="eyebrow">Backgrounds</h3>
        <div style={row}>
          <Token
            name="--bg-primary"
            value="#15151c"
            preview={<div style={swatch("#15151c")} />}
          />
          <Token
            name="--bg-secondary"
            value="#1c1c25"
            preview={<div style={swatch("#1c1c25")} />}
          />
          <Token
            name="--bg-tertiary"
            value="#252531"
            preview={<div style={swatch("#252531")} />}
          />
          <Token
            name="--bg-hover"
            value="#2d2d3c"
            preview={<div style={swatch("#2d2d3c")} />}
          />
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Accent</h3>
        <div style={row}>
          <Token
            name="--accent"
            value="#4d9fff"
            preview={<div style={swatch("#4d9fff")} />}
          />
          <Token
            name="--accent-gradient"
            value="135deg #4d9fff → #7c5cfc"
            preview={
              <div style={swatch("linear-gradient(135deg,#4d9fff,#7c5cfc)")} />
            }
          />
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Colour themes</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          `html[data-color-theme]` swaps the accent family and tints the
          backgrounds; derived overlays follow. Muted, the default, is
          monochrome: a near-white accent in dark, near-black in light, on the
          neutral canvas. Swatch tokens keep each preset's own colours for
          pickers.
        </p>
        <div style={row}>
          {COLOR_THEME_IDS.map((id) => (
            <Token
              key={id}
              name={`--color-theme-${id}-*`}
              value="canvas / accent"
              preview={
                <div
                  style={swatch(
                    `linear-gradient(135deg, var(--color-theme-${id}-canvas) 50%, var(--color-theme-${id}-accent) 50%)`,
                  )}
                />
              }
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Semantic</h3>
        <div style={row}>
          <Token
            name="--success"
            value="#00d4aa"
            preview={<div style={swatch("#00d4aa")} />}
          />
          <Token
            name="--warning"
            value="#f5a623"
            preview={<div style={swatch("#f5a623")} />}
          />
          <Token
            name="--error"
            value="#ff4466"
            preview={<div style={swatch("#ff4466")} />}
          />
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Pull request states</h3>
        <div style={row}>
          {["open", "draft", "merged", "closed"].map((state) => (
            <Token
              key={state}
              name={`--pr-${state}`}
              value="GitHub's hue, per theme"
              preview={<div style={swatch(`var(--pr-${state})`)} />}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Text</h3>
        <div style={row}>
          <Token
            name="--text-primary"
            value="#d8d8e2"
            preview={<div style={{ ...swatch("#d8d8e2") }} />}
          />
          <Token
            name="--text-secondary"
            value="#a8a8b8"
            preview={<div style={swatch("#a8a8b8")} />}
          />
          <Token
            name="--text-muted"
            value="#70708a"
            preview={<div style={swatch("#70708a")} />}
          />
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Toggle</h3>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          A switch&apos;s on state. Follows the accent, except in the Muted
          colour theme, where a monochrome track reads as off and it uses amber.
        </p>
        <div style={row}>
          <Token
            name="--toggle-on"
            value="var(--accent)"
            preview={<div style={swatch("var(--toggle-on)")} />}
          />
          <Token
            name="--toggle-on-border"
            value="var(--accent-hover)"
            preview={<div style={swatch("var(--toggle-on-border)")} />}
          />
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Chart</h3>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          Data-viz roles used by SeriesChart, StackedBar and ReportView.
          Aliases, so each resolves against the active theme — charts never
          reach for a raw colour or for --accent directly.
        </p>
        <div style={row}>
          <Token
            name="--chart-mark"
            value="var(--accent)"
            preview={<div style={swatch("var(--chart-mark)")} />}
          />
          <Token
            name="--chart-mark-hover"
            value="var(--accent-hover)"
            preview={<div style={swatch("var(--chart-mark-hover)")} />}
          />
          <Token
            name="--chart-mark-soft"
            value="var(--accent-overlay-2xl)"
            preview={<div style={swatch("var(--chart-mark-soft)")} />}
          />
          <Token
            name="--chart-grid"
            value="var(--border-subtle)"
            preview={<div style={swatch("var(--chart-grid)")} />}
          />
          <Token
            name="--chart-axis"
            value="var(--border)"
            preview={<div style={swatch("var(--chart-axis)")} />}
          />
          <Token
            name="--chart-label"
            value="var(--text-muted)"
            preview={<div style={swatch("var(--chart-label)")} />}
          />
          <Token
            name="--chart-series-1"
            value="#3987e5 / #2a78d6"
            preview={<div style={swatch("var(--chart-series-1)")} />}
          />
          <Token
            name="--chart-series-2"
            value="#d95926 / #eb6834"
            preview={<div style={swatch("var(--chart-series-2)")} />}
          />
          <Token
            name="--chart-series-3"
            value="#199e70 / #1baf7a"
            preview={<div style={swatch("var(--chart-series-3)")} />}
          />
          <Token
            name="--chart-series-4"
            value="#c98500 / #eda100"
            preview={<div style={swatch("var(--chart-series-4)")} />}
          />
          <Token
            name="--chart-series-other"
            value="var(--text-muted)"
            preview={<div style={swatch("var(--chart-series-other)")} />}
          />
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Syntax (CodeViewer)</h3>
        <div style={row}>
          {SYNTAX_TOKENS.map((name) => (
            <Token
              key={name}
              name={`--syntax-${name}`}
              value="per scheme"
              preview={<div style={swatch(`var(--syntax-${name})`)} />}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Scheme previews (ColorSchemePicker)</h3>
        <div style={row}>
          {SCHEME_PREVIEW_TOKENS.map((name) => (
            <Token
              key={name}
              name={`--scheme-preview-${name}`}
              value="fixed in both schemes"
              preview={<div style={swatch(`var(--scheme-preview-${name})`)} />}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="eyebrow">Terminal (TerminalView)</h3>
        <div style={row}>
          {TERMINAL_TOKENS.map((name) => (
            <Token
              key={name}
              name={`--terminal-${name}`}
              value="per scheme"
              preview={<div style={swatch(`var(--terminal-${name})`)} />}
            />
          ))}
        </div>
      </section>
    </div>
  ),
};

const SYNTAX_TOKENS = [
  "comment",
  "keyword",
  "string",
  "number",
  "title",
  "type",
  "attr",
  "variable",
  "meta",
  "addition",
  "deletion",
];

const SCHEME_PREVIEW_TOKENS = ["light", "dark"].flatMap((scheme) =>
  ["bg", "sidebar", "surface", "line", "line-strong"].map(
    (part) => `${scheme}-${part}`,
  ),
);

const TERMINAL_TOKENS = [
  "bg",
  "fg",
  "cursor",
  "selection",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
];

export const Typography: Story = {
  render: () => (
    <div
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <h1 style={{ margin: 0 }}>Argus</h1>
      <h2 style={{ margin: 0 }}>Section header</h2>
      <h3 style={{ margin: 0 }}>Sub-section</h3>
      <p style={{ margin: 0 }}>Body — 13/1.5 Inter. Dense IDE copy.</p>
      <span style={{ font: "var(--type-ui)" }}>UI · 12/1.4</span>
      <small className="caption">Caption · 11/1.4 muted</small>
      <div className="eyebrow">UPPERCASE EYEBROW</div>
      <code style={{ font: "var(--type-code)" }}>
        pnpm install --frozen-lockfile
      </code>
    </div>
  ),
};

export const Radii: Story = {
  render: () => (
    <div style={{ padding: 24, display: "flex", gap: 12 }}>
      <Token
        name="--border-radius-sm"
        value="6px"
        preview={
          <div style={{ ...swatch("var(--bg-tertiary)"), borderRadius: 6 }} />
        }
      />
      <Token
        name="--border-radius"
        value="12px"
        preview={
          <div style={{ ...swatch("var(--bg-tertiary)"), borderRadius: 12 }} />
        }
      />
      <Token
        name="--border-radius-pill"
        value="999px"
        preview={
          <div style={{ ...swatch("var(--bg-tertiary)"), borderRadius: 999 }} />
        }
      />
    </div>
  ),
};

const CHROME_TOKENS = [
  "canvas",
  "sidebar",
  "surface",
  "selection",
  "hover",
  "hairline",
];

/**
 * The main window's chrome: sidebar, toolbar, tabs, context card. They follow
 * the theme's surfaces; `data-chrome="flat"` on <html> (the web client) swaps
 * in Argus for Mac's neutrals and system type.
 */
export const Chrome: Story = {
  render: () => (
    <div style={{ padding: 24 }}>
      <div style={row}>
        {CHROME_TOKENS.map((name) => (
          <Token
            key={name}
            name={`--chrome-${name}`}
            value={`var(--chrome-${name})`}
            preview={<div style={swatch(`var(--chrome-${name})`)} />}
          />
        ))}
      </div>
    </div>
  ),
};

export const Shadows: Story = {
  render: () => (
    <div style={{ padding: 40, display: "flex", gap: 32 }}>
      {(["sm", "md", "lg"] as const).map((s) => (
        <div
          key={s}
          style={{
            width: 120,
            height: 80,
            background: "var(--bg-tertiary)",
            borderRadius: 12,
            boxShadow: `var(--shadow-${s})`,
            display: "grid",
            placeItems: "center",
            color: "var(--text-secondary)",
            fontSize: 11,
          }}
        >
          shadow-{s}
        </div>
      ))}
    </div>
  ),
};
