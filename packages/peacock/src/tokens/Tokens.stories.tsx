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
            value="#0a0a0f"
            preview={<div style={swatch("#0a0a0f")} />}
          />
          <Token
            name="--bg-secondary"
            value="#111118"
            preview={<div style={swatch("#111118")} />}
          />
          <Token
            name="--bg-tertiary"
            value="#1a1a24"
            preview={<div style={swatch("#1a1a24")} />}
          />
          <Token
            name="--bg-hover"
            value="#222233"
            preview={<div style={swatch("#222233")} />}
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
            value="#f0f0f5"
            preview={<div style={{ ...swatch("#f0f0f5") }} />}
          />
          <Token
            name="--text-secondary"
            value="#a0a0b8"
            preview={<div style={swatch("#a0a0b8")} />}
          />
          <Token
            name="--text-muted"
            value="#55556a"
            preview={<div style={swatch("#55556a")} />}
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
