import type { Meta, StoryObj } from "@storybook/react";
import type { CSSProperties, ReactNode } from "react";

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
          backgrounds; derived overlays follow. Swatch tokens keep each preset's
          own colours for pickers.
        </p>
        <div style={row}>
          {["amber", "grove", "ocean", "ember", "iris", "rose"].map((id) => (
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
        <h3 className="eyebrow">Chart</h3>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          Data-viz roles used by SeriesChart and ReportView. Aliases, so each
          resolves against the active theme — charts never reach for a raw
          colour or for --accent directly.
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
        </div>
      </section>
    </div>
  ),
};

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
