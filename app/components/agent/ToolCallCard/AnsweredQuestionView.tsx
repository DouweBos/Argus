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
