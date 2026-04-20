import type { Question } from "./parseQuestions";
import { AnsweredQuestion } from "@argus/peacock";
import styles from "./AnsweredQuestionView.module.css";

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
      {questions.map((q, qi) => {
        const selected = selections[qi] ?? new Set<string>();
        const answers = q.options
          .filter((opt) => selected.has(opt.label))
          .map((opt) => ({
            label: opt.label,
            description: opt.description,
          }));

        return (
          <AnsweredQuestion
            answers={answers}
            header={q.header ?? q.question}
            key={qi}
          />
        );
      })}
    </div>
  );
}
