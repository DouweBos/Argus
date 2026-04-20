import styles from "./AnsweredQuestion.module.css";

export interface AnsweredQuestionAnswer {
  label: string;
  description?: string;
}

export interface AnsweredQuestionProps {
  header: string;
  answers: AnsweredQuestionAnswer[];
}

export function AnsweredQuestion({ header, answers }: AnsweredQuestionProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>{header}</div>
      {answers.length === 0 ? (
        <div className={styles.empty}>No answer</div>
      ) : (
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
    </div>
  );
}
