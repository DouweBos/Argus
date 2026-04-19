import type { Question } from "./parseQuestions";
import styles from "./QuestionForm.module.css";

interface AnsweredQuestionViewProps {
  questions: Question[];
  /** Map of question index → set of selected option labels. */
  selections: Set<string>[];
}

export function AnsweredQuestionView({
  questions,
  selections,
}: AnsweredQuestionViewProps) {
  return (
    <div className={styles.wrap}>
      {questions.map((q, qi) => (
        <div className={styles.question} key={qi}>
          <div className={styles.header}>
            {q.header ?? `Question ${qi + 1}`}
          </div>
          <div className={styles.prompt}>{q.question}</div>
          <div className={styles.options}>
            {q.options.map((opt, oi) => {
              const checked = selections[qi]?.has(opt.label) ?? false;
              const inputType = q.multiSelect ? "checkbox" : "radio";

              return (
                <label
                  className={`${styles.option} ${checked ? styles.optionChecked : ""}`}
                  key={oi}
                >
                  <input
                    checked={checked}
                    disabled
                    name={`answered-${qi}`}
                    readOnly
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
    </div>
  );
}

/**
 * Parse the structured answer string produced by QuestionForm back into
 * per-question selections. The format is:
 *
 *   The user answered:
 *   - <header or question>: <label>[, <label>...]
 *
 * Missing matches return an empty set for that question.
 */
export function parseAnswerSelections(
  questions: Question[],
  resultText: string,
): Set<string>[] {
  const lines = resultText.split("\n");
  const validLabels = questions.map(
    (q) => new Set(q.options.map((o) => o.label)),
  );

  return questions.map((q, qi) => {
    const key = (q.header ?? q.question).trim();
    const match = lines.find((line) => {
      const m = line.match(/^-\s+([^:]+):\s*(.*)$/);

      return m !== null && m[1].trim() === key;
    });
    if (!match) {
      return new Set<string>();
    }
    const m = match.match(/^-\s+([^:]+):\s*(.*)$/);
    if (!m) {
      return new Set<string>();
    }
    const picks = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const allowed = validLabels[qi];
    // Preserve only labels that exist among this question's options.
    return new Set(picks.filter((p) => allowed.has(p)));
  });
}
