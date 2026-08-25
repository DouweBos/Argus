export interface QuestionOption {
  description?: string;
  label: string;
}

export interface Question {
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
  question: string;
}

function isQuestion(x: unknown): x is Question {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const q = x as Partial<Question>;

  return (
    typeof q.question === "string" &&
    Array.isArray(q.options) &&
    q.options.every(
      (o) => typeof o === "object" && o !== null && typeof o.label === "string",
    )
  );
}

/** Parse the `questions` array out of an AskUserQuestion tool input. */
export function parseQuestions(input: Record<string, unknown>): Question[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(isQuestion);
}

export interface ParsedAnswer {
  /** Free-form text the user typed. */
  note: string;
  /** Option labels the user selected, in any order. */
  picks: Set<string>;
}

/**
 * Parse the structured answer string a QuestionForm emits back into
 * per-question selections + free-form notes. Format:
 *
 *   The user answered:
 *   - <header or question>: <label>[, <label>...][ — note: <text>]
 *   - <header or question>: <freeform text>
 */
export function parseAnswerSelections(
  questions: Question[],
  resultText: string,
): ParsedAnswer[] {
  const lines = resultText.split("\n");

  return questions.map((q) => {
    const key = (q.header ?? q.question).trim();
    const prefix = `- ${key}:`;
    const line = lines.find((l) => l.trimStart().startsWith(prefix));
    if (!line) {
      return { picks: new Set<string>(), note: "" };
    }
    const remainder = line.trimStart().slice(prefix.length).trim();

    const labels = q.options
      .map((o) => o.label)
      .sort((a, b) => b.length - a.length);
    const picks = new Set<string>();
    let consumed = remainder;
    for (const label of labels) {
      if (consumed.includes(label)) {
        picks.add(label);
        consumed = consumed.split(label).join(" ");
      }
    }

    const note = consumed
      .replace(/note:/i, "")
      .replace(/[,—–-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return { picks, note };
  });
}
