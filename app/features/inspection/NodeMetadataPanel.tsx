import { useMemo } from "react";
import { Badge, Icons } from "@argus/peacock";
import styles from "./NodeMetadataPanel.module.css";
import { findNodeById, fmtCoord } from "./resolveNodeVisual";
import { useActiveCapture, useInspectionSelection } from "./store";

/**
 * Replaces the conductor log panel while in Inspect mode. Shows everything
 * we know about the currently selected node — geometry, accessibility,
 * traits, state, and the a11y snapshot entry if the node has one.
 */
export function NodeMetadataPanel() {
  const capture = useActiveCapture();
  const { selectedNodeId } = useInspectionSelection();

  const node = useMemo(() => {
    if (!capture || !selectedNodeId) {
      return null;
    }

    return findNodeById(capture.hierarchy, selectedNodeId);
  }, [capture, selectedNodeId]);

  const a11yEntry = useMemo(() => {
    if (!capture || !selectedNodeId) {
      return null;
    }

    return (
      capture.a11ySnapshot.find((e) => e.nodeId === selectedNodeId) ?? null
    );
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

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Inspecting</span>
        <span className={styles.headerType}>{node.type}</span>
        {node.state.focused && (
          <Badge tone="warning" size="tag">
            Focused
          </Badge>
        )}
      </div>
      <div className={styles.body}>
        <Section title="Identity">
          <Row label="Label" value={node.label} />
          <Row label="Identifier" value={node.identifier} />
          <Row label="Value" value={node.value} />
          <Row label="Hint" value={node.hint} />
          <Row label="Role" value={node.role} />
          <Row label="Traits" value={node.traits?.join(", ")} />
          <Row label="Node id" value={node.id} />
        </Section>
        <Section title="Geometry">
          <Row
            label="Origin"
            value={`${fmtCoord(node.frame.x)}, ${fmtCoord(node.frame.y)}`}
          />
          <Row
            label="Size"
            value={`${fmtCoord(node.frame.w)} × ${fmtCoord(node.frame.h)}`}
          />
          <Row label="Children" value={String(node.children.length)} />
        </Section>
        <Section title="State">
          <Row label="Enabled" value={String(node.state.enabled)} />
          <Row label="Selected" value={String(node.state.selected)} />
          <Row label="Focused" value={String(node.state.focused)} />
          <Row
            label="A11y element"
            value={String(node.isAccessibilityElement)}
          />
        </Section>
        {a11yEntry && (
          <Section title="Accessibility">
            <Row label="Order" value={`#${a11yEntry.order}`} />
            <Row label="Role" value={a11yEntry.role} />
            <Row label="Traits" value={a11yEntry.traits?.join(", ")} />
            <Row label="Label" value={a11yEntry.label} />
            <Row label="Hint" value={a11yEntry.hint} />
            <Row label="Value" value={a11yEntry.value} />
            <Row label="Announcement" value={a11yEntry.announcement} />
            <Row
              label="State"
              value={`enabled:${a11yEntry.state.enabled} · selected:${a11yEntry.state.selected} · focused:${a11yEntry.state.focused}`}
            />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  children: React.ReactNode;
  title: string;
}) {
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
