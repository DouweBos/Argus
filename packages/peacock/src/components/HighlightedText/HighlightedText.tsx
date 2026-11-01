import styles from "./HighlightedText.module.css";

export interface HighlightedTextProps {
  text: string;
  /** UTF-16 offsets into `text` to emphasise, e.g. a fuzzy match's characters. */
  indices?: readonly number[];
  className?: string;
}

/** Text with some of its characters marked: fuzzy-match letters, a search hit. */
export function HighlightedText({
  text,
  indices,
  className,
}: HighlightedTextProps) {
  if (!indices || indices.length === 0) {
    return <span className={className}>{text}</span>;
  }
  const marked = new Set(indices);
  const runs: { marked: boolean; text: string }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const isMarked = marked.has(i);
    const last = runs.at(-1);
    if (last && last.marked === isMarked) {
      last.text += text[i];
    } else {
      runs.push({ marked: isMarked, text: text[i] });
    }
  }

  return (
    <span className={className}>
      {runs.map((run, i) =>
        run.marked ? (
          <mark key={i} className={styles.mark}>
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </span>
  );
}
