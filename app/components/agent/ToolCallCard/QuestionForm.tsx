import type { Question } from "./parseQuestions";
import { useCallback, useMemo, useState } from "react";
import styles from "./QuestionForm.module.css";

interface QuestionFormProps {
  onCancel: () => void;
  onSubmit: (formattedAnswer: string) => void;
  questions: Question[];
}

export function QuestionForm({
  questions,
  onSubmit,
  onCancel,
}: QuestionFormProps) {
  const initial = useMemo(
    () => questions.map(() => new Set<string>()),
    [questions],
  );
  const [selections, setSelections] =
    useState<Set<string>[]>(initial);

  const toggle = useCallback(
    (qIdx: number, label: string, multi: boolean) => {
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
          current.clear();
          current.add(label);
        }

        return next;
      });
    },
    [],
  );

  const allAnswered = selections.every((s) => s.size > 0);

  const handleSubmit = useCallback(() => {
    if (!allAnswered) {return;}

    const lines: string[] = ["The user answered:"];
    questions.forEach((q, i) => {
      const picks = Array.from(selections[i]);
      const label = q.header ?? q.question;
      lines.push(`- ${label}: ${picks.join(", ")}`);
    });
    onSubmit(lines.join("\n"));
  }, [allAnswered, questions, selections, onSubmit]);

  return (
    <div className={styles.wrap}>
      {questions.map((q, qi) => (
        <div className={styles.question} key={qi}>
          <div className={styles.header}>{q.header ?? `Question ${qi + 1}`}</div>
          <div className={styles.prompt}>{q.question}</div>
          <div className={styles.options}>
            {q.options.map((opt, oi) => {
              const checked = selections[qi].has(opt.label);
              const inputType = q.multiSelect ? "checkbox" : "radio";

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
                      <div className={styles.optionDesc}>{opt.description}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div className={styles.actions}>
        <button
          className={styles.submitBtn}
          disabled={!allAnswered}
          onClick={handleSubmit}
        >
          Submit answers
        </button>
        <button className={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
