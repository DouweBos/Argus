/**
 * Tool-call card: collapsible header, per-tool body (Edit/Write → diff,
 * Bash → command, Agent/Task → sub-agent activity, AskUserQuestion → answers,
 * ExitPlanMode → plan) and the inline permission slot. Mirrors Peacock's
 * ToolCall, rebuilt for RN.
 */

import { type ReactNode, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { DiffLines } from "./DiffLines";
import { Markdown } from "./Markdown";
import { Badge, Body, Mono, MONO_FAMILY, Muted, Row, Spinner } from "./ui";
import * as Icons from "./Icons";
import { computeDiffLines, computeDiffStats, writeLines } from "../lib/diffLines";
import type { RemoteToolCall } from "../lib/protocol";
import {
  parseAnswerSelections,
  parseQuestions,
  type Question,
} from "../lib/questions";
import { formatInput, isPathTool, toolSummary } from "../lib/toolCall";
import { openImageViewer } from "../stores/imageViewerStore";
import { useTheme } from "../theme";

const RESULT_PREVIEW_CHARS = 500;

function resultText(tc: RemoteToolCall): string {
  return tc.result_blocks
    .map((b) => (b.type === "text" ? b.text : "[image]"))
    .join("\n");
}

export function ToolCallCard({
  toolCall,
  resolveImage,
  pendingForm,
  permissionActions,
  isPending,
}: {
  toolCall: RemoteToolCall;
  resolveImage: (imageId: string) => string | undefined;
  pendingForm?: ReactNode;
  permissionActions?: ReactNode;
  isPending: boolean;
}) {
  const theme = useTheme();
  const [userExpanded, setUserExpanded] = useState(false);
  const expanded = isPending || userExpanded;

  const isAgent = toolCall.name === "Agent";
  const isSubAgentParent = isAgent || toolCall.name === "Task";
  const children = toolCall.children ?? [];
  const childToolCalls = children.flatMap((c) =>
    c.kind === "tool_use" ? [c.tool_call] : [],
  );
  const previewToolCalls = childToolCalls.slice(-5);
  const agentType = isAgent
    ? ((toolCall.input.subagent_type as string) ?? "") || "Agent"
    : "";
  const agentDesc = isAgent ? ((toolCall.input.description as string) ?? "") : "";
  const summary = toolSummary(toolCall.name, toolCall.input);
  const hasResult = toolCall.result_blocks.length > 0 || toolCall.status === "done";
  const subAgentRunning = isSubAgentParent && toolCall.status === "running";
  const isError = toolCall.is_error ?? toolCall.status === "error";

  const isEdit =
    (toolCall.name === "Edit" || toolCall.name === "MultiEdit") &&
    typeof toolCall.input.old_string === "string" &&
    typeof toolCall.input.new_string === "string";
  const isWrite =
    toolCall.name === "Write" && typeof toolCall.input.content === "string";
  const questions: Question[] =
    toolCall.name === "AskUserQuestion" ? parseQuestions(toolCall.input) : [];
  const isAnsweredQuestion =
    questions.length > 0 && hasResult && !isPending;
  const isExitPlanMode = toolCall.name === "ExitPlanMode";
  const planText =
    isExitPlanMode && typeof toolCall.input.plan === "string"
      ? toolCall.input.plan
      : "";
  const alwaysShowPreview = isEdit || isWrite || isAnsweredQuestion;

  let editStats: { additions: number; deletions: number } | null = null;
  if (isEdit) {
    editStats = computeDiffStats(
      toolCall.input.old_string as string,
      toolCall.input.new_string as string,
    );
  } else if (isWrite) {
    const content = toolCall.input.content as string;
    editStats = {
      additions: content === "" ? 0 : content.split("\n").length,
      deletions: 0,
    };
  }

  const inputPreview = (
    <InputPreview
      toolCall={toolCall}
      isEdit={isEdit}
      isWrite={isWrite}
      isAnsweredQuestion={isAnsweredQuestion}
      questions={questions}
      planText={planText}
    />
  );

  return (
    <View
      style={{
        borderRadius: theme.radiusSm,
        borderWidth: 1,
        borderColor: isPending
          ? theme.warning
          : isError
            ? theme.error
            : theme.borderSubtle,
        backgroundColor: theme.bgTertiary,
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={() => setUserExpanded((v) => !v)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 9,
          paddingVertical: 8,
        }}
      >
        {subAgentRunning ? (
          <Spinner />
        ) : expanded ? (
          <Icons.ChevronDown size={11} color={theme.textMuted} />
        ) : (
          <Icons.ChevronRight size={11} color={theme.textMuted} />
        )}
        <Text style={{ color: theme.text, fontSize: 12.5, fontWeight: "700" }}>
          {isAgent ? agentType : toolCall.name}
        </Text>
        <Text
          numberOfLines={1}
          ellipsizeMode={isPathTool(toolCall.name) ? "head" : "tail"}
          style={{
            flex: 1,
            color: theme.textMuted,
            fontSize: 11.5,
            fontFamily: MONO_FAMILY,
          }}
        >
          {isAgent ? agentDesc : summary}
        </Text>
        {editStats && (editStats.additions > 0 || editStats.deletions > 0) ? (
          <Row gap={4}>
            {editStats.additions > 0 && (
              <Text style={{ color: theme.success, fontSize: 11 }}>
                +{editStats.additions}
              </Text>
            )}
            {editStats.deletions > 0 && (
              <Text style={{ color: theme.error, fontSize: 11 }}>
                -{editStats.deletions}
              </Text>
            )}
          </Row>
        ) : null}
        {isPending && <Badge label="needs approval" tone="warning" />}
        {isError && <Badge label="error" tone="danger" />}
        {subAgentRunning && !isPending && <Badge label="running" tone="accent" />}
      </Pressable>

      {alwaysShowPreview && !expanded && (
        <View style={{ paddingHorizontal: 9, paddingBottom: 9 }}>{inputPreview}</View>
      )}

      {isSubAgentParent && !expanded && previewToolCalls.length > 0 && (
        <View style={{ paddingHorizontal: 9, paddingBottom: 9, gap: 2 }}>
          {previewToolCalls.map((child) => (
            <Row key={child.id} gap={6}>
              <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: "600" }}>
                {child.name === "Agent"
                  ? ((child.input.subagent_type as string) ?? "") || "Agent"
                  : child.name}
              </Text>
              <Mono numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
                {toolSummary(child.name, child.input)}
              </Mono>
            </Row>
          ))}
          {childToolCalls.length > previewToolCalls.length && (
            <Muted>+{childToolCalls.length - previewToolCalls.length} more</Muted>
          )}
        </View>
      )}

      {expanded && (
        <View style={{ paddingHorizontal: 9, paddingBottom: 9, gap: 10 }}>
          {isPending && pendingForm}
          {!(isPending && pendingForm) && (
            <>
              {isAgent && agentDesc ? (
                <Section label="Description">
                  <Mono>{agentDesc}</Mono>
                </Section>
              ) : (
                inputPreview
              )}
              {hasResult && !isAnsweredQuestion && (
                <Section label={isError ? "Error" : "Result"}>
                  <ResultBlocks
                    toolCall={toolCall}
                    resolveImage={resolveImage}
                    isError={isError}
                  />
                </Section>
              )}
            </>
          )}

          {isSubAgentParent && children.length > 0 && (
            <Section label="Sub-agent activity">
              <View style={{ gap: 6 }}>
                {children.map((child, i) =>
                  child.kind === "text" ? (
                    <Muted key={i}>{child.text}</Muted>
                  ) : (
                    <ToolCallCard
                      key={child.tool_call.id}
                      toolCall={child.tool_call}
                      resolveImage={resolveImage}
                      isPending={false}
                    />
                  ),
                )}
              </View>
            </Section>
          )}

          {isPending && permissionActions ? (
            <Row gap={8}>{permissionActions}</Row>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 5 }}>
      <Muted style={{ fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </Muted>
      {children}
    </View>
  );
}

function InputPreview({
  toolCall,
  isEdit,
  isWrite,
  isAnsweredQuestion,
  questions,
  planText,
}: {
  toolCall: RemoteToolCall;
  isEdit: boolean;
  isWrite: boolean;
  isAnsweredQuestion: boolean;
  questions: Question[];
  planText: string;
}) {
  const theme = useTheme();

  if (isEdit) {
    return (
      <DiffLines
        lines={computeDiffLines(
          toolCall.input.old_string as string,
          toolCall.input.new_string as string,
        )}
      />
    );
  }
  if (isWrite) {
    return <DiffLines lines={writeLines(toolCall.input.content as string)} />;
  }
  if (isAnsweredQuestion) {
    const parsed = parseAnswerSelections(questions, resultText(toolCall));

    return (
      <View style={{ gap: 8 }}>
        {questions.map((q, qi) => {
          const answer = parsed[qi] ?? { picks: new Set<string>(), note: "" };
          const picked = q.options.filter((o) => answer.picks.has(o.label));

          return (
            <View key={qi} style={{ gap: 3 }}>
              <Muted>{q.header ?? q.question}</Muted>
              {picked.map((o) => (
                <Row key={o.label} gap={6}>
                  <Icons.Check size={12} color={theme.success} />
                  <Body style={{ fontSize: 13 }}>{o.label}</Body>
                </Row>
              ))}
              {answer.note ? <Muted>{answer.note}</Muted> : null}
            </View>
          );
        })}
      </View>
    );
  }
  if (planText) {
    return (
      <Section label="Plan">
        <Markdown text={planText} />
      </Section>
    );
  }

  return (
    <Section label="Input">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Mono>{formatInput(toolCall.name, toolCall.input)}</Mono>
      </ScrollView>
    </Section>
  );
}

function ResultBlocks({
  toolCall,
  resolveImage,
  isError,
}: {
  toolCall: RemoteToolCall;
  resolveImage: (imageId: string) => string | undefined;
  isError: boolean;
}) {
  const theme = useTheme();

  if (toolCall.result_blocks.length === 0) {
    return <Muted>(no output)</Muted>;
  }

  return (
    <View style={{ gap: 6 }}>
      {toolCall.result_blocks.map((block, i) => {
        if (block.type === "image") {
          const uri = resolveImage(block.image_id);

          return uri ? (
            <Pressable
              key={i}
              accessibilityLabel="View image"
              onPress={() => openImageViewer([uri])}
            >
              <Image
                source={{ uri }}
                resizeMode="contain"
                style={{
                  width: "100%",
                  height: 220,
                  borderRadius: theme.radiusSm,
                  backgroundColor: theme.mediaBg,
                }}
              />
            </Pressable>
          ) : null;
        }
        const text = block.text.slice(0, RESULT_PREVIEW_CHARS);

        return (
          <Mono
            key={i}
            style={{ color: isError ? theme.error : theme.textSecondary }}
          >
            {text}
            {block.text.length > RESULT_PREVIEW_CHARS ? "…" : ""}
          </Mono>
        );
      })}
    </View>
  );
}
