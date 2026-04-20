import type { Question } from "./parseQuestions";

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

    return new Set(picks.filter((p) => allowed.has(p)));
  });
}
