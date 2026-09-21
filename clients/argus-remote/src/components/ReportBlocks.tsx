/**
 * A run's structured report, rendered for a phone.
 *
 * The blocks are data, never markup — the computer validates the union before
 * it sends it, so everything here is well-formed. `proposals` and `sessions`
 * resolve live objects the desktop renders as cards; a phone has no inbox
 * surface, so they are named rather than faked.
 */

import { ScrollView, View } from "react-native";
import type { RemoteReportBlock, RemoteReportTone } from "../lib/protocol";
import { useTheme } from "../theme";
import { Markdown } from "./Markdown";
import { Body, Card, Mono, Muted, Row, Title } from "./ui";

function toneColor(
  theme: ReturnType<typeof useTheme>,
  tone: RemoteReportTone | undefined,
): string {
  switch (tone) {
    case "critical":
      return theme.error;
    case "warning":
      return theme.warning;
    case "positive":
      return theme.success;
    default:
      return theme.textSecondary;
  }
}

function Stats({
  block,
}: {
  block: Extract<RemoteReportBlock, { type: "stats" }>;
}) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {block.items.map((item) => (
        <Card key={item.label} style={{ flexGrow: 1, minWidth: 120, gap: 2 }}>
          <Muted>{item.label}</Muted>
          <Title>{item.value}</Title>
          {item.delta != null && (
            <Muted
              style={{
                color: item.delta >= 0 ? theme.success : theme.error,
              }}
            >
              {item.delta >= 0 ? `+${item.delta}` : item.delta}
            </Muted>
          )}
        </Card>
      ))}
    </View>
  );
}

/** Horizontally scrollable — a table with six columns does not fit a phone. */
function Table({
  block,
}: {
  block: Extract<RemoteReportBlock, { type: "table" }>;
}) {
  const cell = { width: 130, paddingRight: 10 };

  return (
    <Card>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ gap: 6 }}>
          <Row gap={0}>
            {block.columns.map((column) => (
              <View key={column} style={cell}>
                <Muted numberOfLines={1}>{column}</Muted>
              </View>
            ))}
          </Row>
          {block.rows.map((row, index) => (
            <Row key={index} gap={0}>
              {row.map((value, column) => (
                <View key={column} style={cell}>
                  <Body numberOfLines={2}>{String(value)}</Body>
                </View>
              ))}
            </Row>
          ))}
        </View>
      </ScrollView>
      {block.rows.length === 0 && <Muted>No rows.</Muted>}
    </Card>
  );
}

function Series({
  block,
}: {
  block: Extract<RemoteReportBlock, { type: "series" }>;
}) {
  const theme = useTheme();
  const peak = Math.max(...block.values.map(Math.abs), 1);

  return (
    <Card>
      {block.label ? <Muted>{block.label}</Muted> : null}
      {block.labels.map((label, index) => {
        const value = block.values[index] ?? 0;

        return (
          <Row key={`${label}-${index}`} gap={8}>
            <View style={{ width: 70 }}>
              <Muted numberOfLines={1}>{label}</Muted>
            </View>
            <View
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                backgroundColor: theme.bgTertiary,
              }}
            >
              <View
                style={{
                  width: `${(Math.abs(value) / peak) * 100}%`,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: theme.accent,
                }}
              />
            </View>
            <Mono>{String(value)}</Mono>
          </Row>
        );
      })}
    </Card>
  );
}

function Block({ block }: { block: RemoteReportBlock }) {
  const theme = useTheme();

  switch (block.type) {
    case "heading":
      return <Title>{block.text}</Title>;
    case "markdown":
      return <Markdown text={block.text} />;
    case "stats":
      return <Stats block={block} />;
    case "table":
      return <Table block={block} />;
    case "series":
      return <Series block={block} />;
    case "list":
      return (
        <Card>
          {block.items.map((item, index) => (
            <Row key={index} gap={8}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  marginTop: 6,
                  backgroundColor: toneColor(theme, item.tone),
                }}
              />
              <Body style={{ flex: 1 }}>{item.text}</Body>
            </Row>
          ))}
        </Card>
      );
    // Live objects the desktop resolves into cards. Naming the count is honest;
    // rendering an id would not be.
    case "proposals":
      return (
        <Muted>
          {block.ids.length} proposal{block.ids.length === 1 ? "" : "s"} — open
          the inbox on your computer to act on them.
        </Muted>
      );
    case "sessions":
      return (
        <Muted>
          {block.ids.length} session{block.ids.length === 1 ? "" : "s"} started
          by this run.
        </Muted>
      );
  }
}

export function ReportBlocks({ blocks }: { blocks: RemoteReportBlock[] }) {
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </View>
  );
}
