import styles from "./AnsweredQuestion.module.css";

export interface AnsweredQuestionAnswer {
  label: string;
  description?: string;
}

export interface AnsweredQuestionProps {
  header: string;
  answers: AnsweredQuestionAnswer[];
  /** Free-form note typed alongside (or instead of) selected options. */
  note?: string;
}

export function AnsweredQuestion({
  header,
  answers,
  note,
}: AnsweredQuestionProps) {
  const hasAnswers = answers.length > 0;
  const hasNote = !!note && note.trim().length > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>{header}</div>
      {!hasAnswers && !hasNote && <div className={styles.empty}>No answer</div>}
      {hasAnswers && (
        <ul className={styles.answers}>
          {answers.map((a, i) => (
            <li className={styles.answer} key={i}>
              <span className={styles.label}>{a.label}</span>
              {a.description && (
                <span className={styles.description}>{a.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasNote && <div className={styles.note}>{note}</div>}
    </div>
  );
}
