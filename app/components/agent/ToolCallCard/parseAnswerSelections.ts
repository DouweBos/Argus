import type { Question } from "./parseQuestions";

export interface ParsedAnswer {
  /** Free-form text the user typed (the `note: …` suffix, or a custom-only answer). */
  note: string;
  /** Option labels the user selected, in any order. */
  picks: Set<string>;
}

/**
 * Parse the structured answer string produced by QuestionForm back into
 * per-question selections + free-form notes. The format QuestionForm emits is:
 *
 *   The user answered:
 *   - <header or question>: <label>[, <label>...][ — note: <text>]
 *   - <header or question>: <freeform text>            (when no labels picked)
 *
 * The header itself can contain colons, and option labels can contain commas,
 * so we don't comma-split. Instead we match the line by `"- <key>: "` prefix
 * and then scan the remainder for occurrences of each known option label.
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

    // Scan for each option label as a substring. Longest labels first so that
    // a label which is a prefix of another doesn't shadow it.
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

    // Whatever's left (after removing matched labels and the `note:` marker,
    // commas, em-dashes, and whitespace) is the free-form note.
    const note = consumed
      .replace(/note:/i, "")
      .replace(/[,—–-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return { picks, note };
  });
}
