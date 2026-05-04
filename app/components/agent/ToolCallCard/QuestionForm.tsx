import type { Question } from "./parseQuestions";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button, TextArea } from "@argus/peacock";
import styles from "./QuestionForm.module.css";

interface QuestionFormProps {
  onCancel: () => void;
  onSubmit: (formattedAnswer: string) => void;
  questions: Question[];
}

const CUSTOM_KEY = "__argus_custom__";

export function QuestionForm({
  questions,
  onSubmit,
  onCancel,
}: QuestionFormProps) {
  const initial = useMemo(
    () => questions.map(() => new Set<string>()),
    [questions],
  );
  const [selections, setSelections] = useState<Set<string>[]>(initial);
  const [customAnswers, setCustomAnswers] = useState<string[]>(() =>
    questions.map(() => ""),
  );
  const customInputRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

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
          const multi = questions[qIdx]?.multiSelect;
          if (!multi) {
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
    if (s.has(CUSTOM_KEY) && customAnswers[i].trim().length === 0) {
      return false;
    }

    return true;
  });

  const handleSubmit = useCallback(() => {
    if (!allAnswered) {
      return;
    }

    const lines: string[] = ["The user answered:"];
    questions.forEach((q, i) => {
      const picks = Array.from(selections[i]).filter((p) => p !== CUSTOM_KEY);
      const useCustom = selections[i].has(CUSTOM_KEY);
      const custom = customAnswers[i].trim();
      const label = q.header ?? q.question;
      const parts: string[] = [];
      if (picks.length > 0) {
        parts.push(picks.join(", "));
      }
      if (useCustom && custom) {
        parts.push(picks.length > 0 ? `note: ${custom}` : custom);
      }
      lines.push(`- ${label}: ${parts.join(" — ")}`);
    });
    onSubmit(lines.join("\n"));
  }, [allAnswered, customAnswers, questions, selections, onSubmit]);

  return (
    <div className={styles.wrap}>
      {questions.map((q, qi) => {
        const inputType = q.multiSelect ? "checkbox" : "radio";
        const customChecked = selections[qi].has(CUSTOM_KEY);

        return (
          <div className={styles.question} key={qi}>
            <div className={styles.header}>
              {q.header ?? `Question ${qi + 1}`}
            </div>
            <div className={styles.prompt}>{q.question}</div>
            <div className={styles.options}>
              {q.options.map((opt, oi) => {
                const checked = selections[qi].has(opt.label);

                return (
                  <label
                    className={`${styles.option} ${checked ? styles.optionChecked : ""}`}
                    key={oi}
                  >
                    <input
                      checked={checked}
                      name={`q-${qi}`}
                      onChange={() => toggle(qi, opt.label, !!q.multiSelect)}
                      type={inputType}
                    />
                    <div className={styles.optionBody}>
                      <div className={styles.optionLabel}>{opt.label}</div>
                      {opt.description && (
                        <div className={styles.optionDesc}>
                          {opt.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
              <label
                className={`${styles.option} ${styles.customOption} ${customChecked ? styles.optionChecked : ""}`}
              >
                <input
                  checked={customChecked}
                  name={`q-${qi}`}
                  onChange={() => {
                    toggle(qi, CUSTOM_KEY, !!q.multiSelect);
                    if (!customChecked) {
                      requestAnimationFrame(() => {
                        customInputRefs.current[qi]?.focus();
                      });
                    }
                  }}
                  type={inputType}
                />
                <div className={styles.optionBody}>
                  <TextArea
                    className={styles.customInput}
                    placeholder="Type your own answer…"
                    rows={2}
                    ref={(el) => {
                      customInputRefs.current[qi] = el;
                    }}
                    value={customAnswers[qi]}
                    onChange={(e) => setCustomAnswer(qi, e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                </div>
              </label>
            </div>
          </div>
        );
      })}
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          disabled={!allAnswered}
          onClick={handleSubmit}
        >
          Submit answers
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
