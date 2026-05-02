import type { ParsedAnswer } from "./parseAnswerSelections";
import type { Question } from "./parseQuestions";
import { AnsweredQuestion } from "@argus/peacock";
import styles from "./AnsweredQuestionView.module.css";

interface AnsweredQuestionViewProps {
  questions: Question[];
  /** Per-question parsed answer (selected option labels + free-form note). */
  selections: ParsedAnswer[];
}

export function AnsweredQuestionView({
  questions,
  selections,
}: AnsweredQuestionViewProps) {
  return (
    <div className={styles.wrap}>
      {questions.map((q, qi) => {
        const parsed = selections[qi] ?? { picks: new Set<string>(), note: "" };
        const answers = q.options
          .filter((opt) => parsed.picks.has(opt.label))
          .map((opt) => ({
            label: opt.label,
            description: opt.description,
          }));

        return (
          <AnsweredQuestion
            answers={answers}
            header={q.header ?? q.question}
            key={qi}
            note={parsed.note}
          />
        );
      })}
    </div>
  );
}
