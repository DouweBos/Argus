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

export function parseQuestions(input: Record<string, unknown>): Question[] {
  const raw = input.questions;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(isQuestion);
}
