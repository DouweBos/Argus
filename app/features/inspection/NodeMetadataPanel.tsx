import type { HierarchyNode } from "./types";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { ColorSwatch, Icons, Spinner } from "@argus/peacock";
import styles from "./NodeMetadataPanel.module.css";
import { NodePropsSection } from "./NodePropsSection";
import { BoolEdit, ColorEdit, NumberEdit, TextEdit } from "./PropertyEditors";
import { findNodeById, fmtCoord } from "./resolveNodeVisual";
import {
  useActiveCapture,
  useInspectionSelection,
  usePropertyEdit,
} from "./store";

interface NodeMetadataPanelProps {
  /** Live device key — enables in-place editing when present. */
  deviceKey?: string | null;
}

/**
 * Only genuine UIKit text controls accept a native `text`/`textColor` set. RN
 * Fabric text (`RCTParagraphComponentView`, …) renders from React state and has
 * no working native setter, so we show those rows read-only rather than let the
 * user submit an edit that always fails. (Editing RN text needs the JS path.)
 */
const TEXT_SETTABLE_CLASSES = new Set([
  "UILabel",
  "UITextField",
  "UITextView",
  "UIButton",
]);

/**
 * Replaces the conductor log panel while in Inspect mode. Surfaces the full
 * native detail for the selected node and — against a live device — lets you
 * edit the whitelisted properties (`conductor native-set`) in place.
 */
export function NodeMetadataPanel({ deviceKey }: NodeMetadataPanelProps) {
  const capture = useActiveCapture();
  const { selectedNodeId } = useInspectionSelection();
  const edit = usePropertyEdit();
  const editable = !!deviceKey;

  const node = useMemo(() => {
    if (!capture || !selectedNodeId) {
      return null;
    }

    return findNodeById(capture.hierarchy, selectedNodeId);
  }, [capture, selectedNodeId]);

  if (!node) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          <Icons.SearchIcon size={20} />
          <span>Click an element in the capture to see its metadata here.</span>
        </div>
      </div>
    );
  }

  const rect = node.absFrame ?? node.frame;
  const ctx = { deviceKey: deviceKey ?? null, nodeId: node.id, editable };
  const text = node.text ?? node.title;
  const textSettable = editable && TEXT_SETTABLE_CLASSES.has(node.class);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Inspecting</span>
        <span className={styles.headerType}>{node.class}</span>
        {edit.saving && (
          <span className={styles.savingHint}>
            <Spinner size="sm" aria-label="Applying" />
            Applying…
          </span>
        )}
      </div>
      {edit.error && <div className={styles.editError}>{edit.error}</div>}
      <div className={styles.body}>
        <Section title="Identity">
          {text !== undefined ? (
            <EditRow label="Text">
              {textSettable ? (
                <TextEdit {...ctx} propKey="text" value={text} />
              ) : (
                <>
                  {text}
                  {editable && (
                    <span className={styles.managedHint}> · React-managed</span>
                  )}
                </>
              )}
            </EditRow>
          ) : null}
          <Row label="Placeholder" value={node.placeholder} />
          <Row label="A11y label" value={node.accessibilityLabel} />
          <Row label="A11y id" value={node.accessibilityIdentifier} />
          <Row label="Node id" value={node.id} />
        </Section>
        <Section title="Geometry">
          <Row
            label="Origin"
            value={`${fmtCoord(rect.x)}, ${fmtCoord(rect.y)}`}
          />
          <Row
            label="Size"
            value={`${fmtCoord(rect.w)} × ${fmtCoord(rect.h)}`}
          />
          <Row label="Depth" value={String(node.depth)} />
          <Row
            label="Z"
            value={node.z !== undefined ? fmtCoord(node.z) : undefined}
          />
          <Row label="Children" value={String(node.children.length)} />
        </Section>
        <AppearanceSection node={node} ctx={ctx} />
        <LayerSection node={node} ctx={ctx} />
        {node.rn && (
          <Section title="React Native">
            <Row label="reactTag" value={node.rn.reactTag} />
            <Row label="nativeID" value={node.rn.nativeID} />
            <Row label="testID" value={node.rn.testID} />
          </Section>
        )}
        <NodePropsSection deviceKey={ctx.deviceKey} nodeId={node.id} />
        <Section title="State">
          {editable ? (
            <>
              <EditRow label="Alpha">
                <NumberEdit
                  {...ctx}
                  propKey="alpha"
                  value={node.alpha ?? 1}
                  step={0.05}
                  min={0}
                  max={1}
                />
              </EditRow>
              <EditRow label="Hidden">
                <BoolEdit
                  {...ctx}
                  propKey="hidden"
                  value={node.hidden ?? false}
                />
              </EditRow>
            </>
          ) : (
            <>
              <Row
                label="Alpha"
                value={
                  node.alpha !== undefined ? fmtCoord(node.alpha) : undefined
                }
              />
              <Row label="Hidden" value={node.hidden ? "true" : undefined} />
            </>
          )}
          <Row
            label="Enabled"
            value={
              node.enabled !== undefined ? String(node.enabled) : undefined
            }
          />
          <Row
            label="Truncated"
            value={
              node.truncated !== undefined
                ? `${node.truncated} subviews`
                : undefined
            }
          />
        </Section>
      </div>
    </div>
  );
}

interface EditCtx {
  deviceKey: string | null;
  editable: boolean;
  nodeId: string;
}

function AppearanceSection({
  node,
  ctx,
}: {
  ctx: EditCtx;
  node: HierarchyNode;
}) {
  const hasFont = Boolean(node.font && (node.font.name || node.font.size));
  const anyColor =
    node.backgroundColor ||
    node.textColor ||
    node.titleColor ||
    node.tintColor ||
    (node.gradientColors && node.gradientColors.length > 0);
  if (!anyColor && !hasFont && !node.image) {
    return null;
  }

  return (
    <Section title="Appearance">
      <ColorRow
        label="Background"
        color={node.backgroundColor}
        propKey="backgroundColor"
        ctx={ctx}
      />
      <ColorRow
        label="Text"
        color={node.textColor}
        propKey={
          TEXT_SETTABLE_CLASSES.has(node.class) ? "textColor" : undefined
        }
        ctx={ctx}
      />
      <ColorRow label="Title" color={node.titleColor} />
      <ColorRow
        label="Tint"
        color={node.tintColor}
        propKey="tintColor"
        ctx={ctx}
      />
      {node.gradientColors?.map((c, i) => (
        <ColorRow key={i} label={i === 0 ? "Gradient" : ""} color={c} />
      ))}
      {hasFont && node.font && (
        <Row label="Font" value={fontLabel(node.font)} />
      )}
      {node.image && (
        <Row
          label="Image"
          value={`${node.image.w}×${node.image.h}@${fmtCoord(node.image.scale)}x${node.image.name ? ` · ${node.image.name}` : ""}`}
        />
      )}
    </Section>
  );
}

function LayerSection({ node, ctx }: { ctx: EditCtx; node: HierarchyNode }) {
  const hasBorder = node.borderWidth !== undefined;
  const hasShadow = node.shadowOpacity !== undefined;
  if (
    node.cornerRadius === undefined &&
    !hasBorder &&
    !hasShadow &&
    !node.masksToBounds &&
    !node.hasMask &&
    !node.transform3D
  ) {
    return null;
  }

  return (
    <Section title="Layer">
      {node.cornerRadius !== undefined && (
        <NumberRow
          label="Corner radius"
          value={node.cornerRadius}
          propKey="cornerRadius"
          ctx={ctx}
        />
      )}
      <Row
        label="Masks to bounds"
        value={node.masksToBounds ? "true" : undefined}
      />
      <Row label="Mask" value={node.hasMask ? "true" : undefined} />
      {hasBorder && (
        <NumberRow
          label="Border"
          value={node.borderWidth ?? 0}
          propKey="borderWidth"
          ctx={ctx}
        />
      )}
      <ColorRow
        label="Border color"
        color={node.borderColor}
        propKey="borderColor"
        ctx={ctx}
      />
      {hasShadow && (
        <Row
          label="Shadow"
          value={`opacity ${fmtCoord(node.shadowOpacity ?? 0)} · radius ${fmtCoord(node.shadowRadius ?? 0)}`}
        />
      )}
      <ColorRow label="Shadow color" color={node.shadowColor} />
      <Row
        label="3D transform"
        value={node.transform3D ? "non-identity" : undefined}
      />
    </Section>
  );
}

function fontLabel(font: NonNullable<HierarchyNode["font"]>): string {
  const bits = [font.family || font.name, `${fmtCoord(font.size)}pt`];
  if (font.weight !== undefined) {
    bits.push(`w${fmtCoord(font.weight)}`);
  }
  if (font.bold) {
    bits.push("bold");
  }
  if (font.italic) {
    bits.push("italic");
  }

  return bits.filter(Boolean).join(" · ");
}

function Section({ title, children }: { children: ReactNode; title: string }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </div>
  );
}

function EditRow({ label, children }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{children}</span>
    </div>
  );
}

/** Color row that becomes editable when `ctx.editable` and a `propKey` is given. */
function ColorRow({
  label,
  color,
  propKey,
  ctx,
}: {
  color?: string;
  ctx?: EditCtx;
  label: string;
  propKey?: string;
}) {
  if (!color) {
    return null;
  }
  if (ctx?.editable && propKey) {
    return (
      <EditRow label={label}>
        <ColorEdit
          deviceKey={ctx.deviceKey}
          nodeId={ctx.nodeId}
          propKey={propKey}
          value={color}
        />
      </EditRow>
    );
  }

  return (
    <EditRow label={label}>
      <ColorSwatch color={color} />
    </EditRow>
  );
}

/** Number row that becomes editable when `ctx.editable`. */
function NumberRow({
  label,
  value,
  propKey,
  ctx,
}: {
  ctx: EditCtx;
  label: string;
  propKey: string;
  value: number;
}) {
  if (ctx.editable) {
    return (
      <EditRow label={label}>
        <NumberEdit
          deviceKey={ctx.deviceKey}
          nodeId={ctx.nodeId}
          propKey={propKey}
          value={value}
          min={0}
        />
      </EditRow>
    );
  }

  return <Row label={label} value={fmtCoord(value)} />;
}
