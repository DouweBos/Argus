/**
 * AskUserQuestion form — radio/checkbox options plus a free-text "own answer"
 * per question. On submit it emits the same formatted answer string the desktop
 * and web clients send back, so the agent sees one format everywhere.
 */

import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import type { Question } from "../lib/questions";
import { Body, Btn, Muted, Row, TextField, Title } from "./ui";
import { useTheme } from "../theme";

const CUSTOM_KEY = "__argus_custom__";

export function QuestionForm({
  questions,
  onSubmit,
  onCancel,
}: {
  questions: Question[];
  onSubmit: (formattedAnswer: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [selections, setSelections] = useState<Set<string>[]>(() =>
    questions.map(() => new Set<string>()),
  );
  const [customAnswers, setCustomAnswers] = useState<string[]>(() =>
    questions.map(() => ""),
  );

  const toggle = useCallback((qIdx: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const next = prev.map((s) => new Set(s));
      const current = next[qIdx];
      if (multi) {
        if (current.has(label)) {
          current.delete(label);
        } else {
          current.add(label);
        }
      } else {
        const wasSelected = current.has(label);
        current.clear();
        if (!wasSelected) {
          current.add(label);
        }
      }

      return next;
    });
  }, []);

  const setCustomAnswer = useCallback(
    (qIdx: number, value: string) => {
      setCustomAnswers((prev) => {
        const next = [...prev];
        next[qIdx] = value;

        return next;
      });
      if (value.trim().length > 0) {
        setSelections((prev) => {
          const next = prev.map((s) => new Set(s));
          if (!questions[qIdx]?.multiSelect) {
            next[qIdx].clear();
          }
          next[qIdx].add(CUSTOM_KEY);

          return next;
        });
      }
    },
    [questions],
  );

  const allAnswered = selections.every((s, i) => {
    if (s.size === 0) {
      return false;
    }

    return !(s.has(CUSTOM_KEY) && customAnswers[i].trim().length === 0);
  });

  const submit = useCallback(() => {
    if (!allAnswered) {
      return;
    }
    const lines: string[] = ["The user answered:"];
    questions.forEach((q, i) => {
      const picks = Array.from(selections[i]).filter((p) => p !== CUSTOM_KEY);
      const useCustom = selections[i].has(CUSTOM_KEY);
      const custom = customAnswers[i].trim();
      const parts: string[] = [];
      if (picks.length > 0) {
        parts.push(picks.join(", "));
      }
      if (useCustom && custom) {
        parts.push(picks.length > 0 ? `note: ${custom}` : custom);
      }
      lines.push(`- ${q.header ?? q.question}: ${parts.join(" — ")}`);
    });
    onSubmit(lines.join("\n"));
  }, [allAnswered, customAnswers, onSubmit, questions, selections]);

  return (
    <View style={{ gap: 14 }}>
      {questions.map((q, qi) => {
        const customChecked = selections[qi].has(CUSTOM_KEY);

        return (
          <View key={qi} style={{ gap: 8 }}>
            <Title style={{ fontSize: 15 }}>
              {q.header ?? `Question ${qi + 1}`}
            </Title>
            <Muted>{q.question}</Muted>
            <View style={{ gap: 6 }}>
              {q.options.map((opt, oi) => {
                const checked = selections[qi].has(opt.label);

                return (
                  <Pressable
                    key={oi}
                    onPress={() => toggle(qi, opt.label, !!q.multiSelect)}
                    style={{
                      flexDirection: "row",
                      gap: 10,
                      padding: 10,
                      borderRadius: theme.radiusSm,
                      borderWidth: 1,
                      borderColor: checked ? theme.accentBorder : theme.border,
                      backgroundColor: checked ? theme.accentSoft : theme.bgTertiary,
                    }}
                  >
                    <Selector checked={checked} multi={!!q.multiSelect} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body>{opt.label}</Body>
                      {opt.description ? <Muted>{opt.description}</Muted> : null}
                    </View>
                  </Pressable>
                );
              })}
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  padding: 10,
                  borderRadius: theme.radiusSm,
                  borderWidth: 1,
                  borderColor: customChecked ? theme.accentBorder : theme.border,
                  backgroundColor: customChecked ? theme.accentSoft : theme.bgTertiary,
                }}
              >
                <Selector checked={customChecked} multi={!!q.multiSelect} />
                <View style={{ flex: 1 }}>
                  <TextField
                    multiline
                    value={customAnswers[qi]}
                    placeholder="Type your own answer…"
                    onChangeText={(v) => setCustomAnswer(qi, v)}
                  />
                </View>
              </View>
            </View>
          </View>
        );
      })}
      <Row>
        <Btn
          label="Submit answers"
          size="sm"
          disabled={!allAnswered}
          onPress={submit}
        />
        <Btn label="Cancel" size="sm" tone="ghost" onPress={onCancel} />
      </Row>
    </View>
  );
}

function Selector({ checked, multi }: { checked: boolean; multi: boolean }) {
  const theme = useTheme();

  return (
    <View
      style={{
        width: 18,
        height: 18,
        borderRadius: multi ? 4 : 9,
        borderWidth: 1.5,
        borderColor: checked ? theme.accent : theme.borderStrong,
        backgroundColor: checked ? theme.accent : "transparent",
        marginTop: 2,
      }}
    />
  );
}
